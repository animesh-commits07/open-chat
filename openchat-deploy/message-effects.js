import {
  collection,doc,onSnapshot,orderBy,query,limit,setDoc,serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import {ANIMATED_MESSAGE_EFFECTS,validAnimatedMessageEffect}
  from './animated-messages.js?v=manual-fx-29-20261012';

// A single validated signal document replays an effect around ONE chat
// message on both devices. Never changes message text, reactions, reply,
// delivery/seen timestamps or any unrelated mini-game/doodle collections.
export const MESSAGE_EFFECTS=Object.entries(ANIMATED_MESSAGE_EFFECTS)
  .map(([id,data])=>({id,emoji:data.icon,label:data.label}));
const EFFECT_NAMES=new Set(MESSAGE_EFFECTS.map(effect=>effect.id));

export function createMessageEffectsController({db,getContext,onStatus,onPlay}){
  const messages=document.getElementById('messages');
  let context=null,unsubscribe=null,firstServerSnapshot=false;
  let seen=new Map(),revealTimers=new Set(),choice=null;
  let writes=new Set(),queuedReplay=new Map();
  let openingReplayChecked=false;
  const current=()=>{
    const now=getContext();
    return !!context&&!!now&&now.threadId===context.threadId&&now.uid===context.uid;
  };
  function dismiss(){
    if(choice?.element)choice.element.remove();
    choice=null;
  }
  function clearTimers(){
    for(const timer of revealTimers)clearTimeout(timer);
    revealTimers.clear();
  }
  // One click produces the same server-confirmed animation on BOTH phones.
  function play(messageId,effect,fullScreen=false){
    if(!current()||!EFFECT_NAMES.has(effect))return false;
    return !!onPlay?.(messageId,effect,fullScreen);
  }
  function afterMessagesRender(){
    if(!current())return;
    for(const [messageId,item] of queuedReplay){
      if(item.expiry<=Date.now()){queuedReplay.delete(messageId);continue}
      if(play(messageId,item.effect))queuedReplay.delete(messageId);
    }
  }
  function handleSnapshot(snapshot,original){
    if(context!==original||!current()||snapshot.metadata.fromCache)return;
    const initializing=!firstServerSnapshot;
    for(const item of snapshot.docs){
      if(item.metadata.hasPendingWrites)continue;
      const data=item.data(),nonce=data?.playId;
      if(typeof nonce!=='string'||!EFFECT_NAMES.has(data?.effect))continue;
      const last=seen.get(item.id);
      if(last===nonce)continue;
      seen.set(item.id,nonce);
      const when=data?.triggeredAt?.toMillis?.()||0;
      // Never autoplay historical effects when revisiting an old chat.
      // However, an effect received during initial sync should still play.
      if(initializing && (when===0||Date.now()-when>3000))continue;
      if(!play(item.id,data.effect)){
        queuedReplay.set(item.id,{effect:data.effect,expiry:Date.now()+3000});
      }
    }
    firstServerSnapshot=true;
  }
  // Replay only the newest incoming animated message once per recipient/device.
  // Keep the seen marker per account and conversation, across chat reopening.
  function observeMessages(snapshot){
    if(!current()||openingReplayChecked||snapshot.metadata.fromCache)return;
    const candidates=snapshot.docs.filter(item=>!item.metadata.hasPendingWrites &&
      item.data()?.senderId!==context.uid &&
      validAnimatedMessageEffect(item.data()?.effect));
    if(!candidates.length){openingReplayChecked=true;return}
    const latest=candidates[0],data=latest.data();
    const key='openchat_latest_animated_seen_v2:'+context.uid+':'+context.threadId;
    const marker=latest.id;
    let previous='';
    try{previous=localStorage.getItem(key)||''}catch{}
    if(previous===marker){openingReplayChecked=true;return}
    // Only acknowledge once playback can actually start.
    if(play(latest.id,data.effect,true)){
      try{localStorage.setItem(key,marker)}catch{}
      openingReplayChecked=true;
    }
  }
  function open(threadId,uid){
    close();
    if(!threadId||!uid)return;
    context={threadId,uid};openingReplayChecked=false;
    const original=context;
    unsubscribe=onSnapshot(
      query(collection(db,'threads',threadId,'messageEffects'),
        orderBy('triggeredAt','desc'),limit(120)),
      {includeMetadataChanges:true},
      snapshot=>handleSnapshot(snapshot,original),
      error=>{
        if(context!==original||!current())return;
        onStatus('Animated Messages sync unavailable: '+(error?.message||'Check Firebase Rules'));
      }
    );
  }
  function beforeMessagesRender(){
    dismiss();
    clearTimers();
  }
  function showChoices(node,messageId){
    if(!current()||!node?.isConnected)return;
    if(choice?.messageId===messageId){dismiss();return}
    dismiss();
    const menu=document.createElement('div');
    menu.className='message-effect-menu';
    menu.setAttribute('role','group');
    menu.setAttribute('aria-label','Choose a message animation to play on both phones');
    const label=document.createElement('span');
    label.className='message-effect-menu-label';
    label.textContent='Animate this message for both friends';
    menu.append(label);
    const search=document.createElement('input');
    search.type='search';search.className='message-effect-search';
    search.placeholder='Search 28 effects…';
    search.setAttribute('aria-label','Search message animations');
    menu.append(search);
    for(const effect of MESSAGE_EFFECTS){
      const button=document.createElement('button');
      button.type='button';
      button.className='message-effect-choice';
      button.textContent=effect.emoji+' '+effect.label;
      button.dataset.effect=effect.id;
      button.setAttribute('aria-label','Play '+effect.label+' on both phones');
      button.onclick=event=>{
        event.stopPropagation();
        dismiss();
        void trigger(messageId,effect.id);
      };
      menu.append(button);
    }
    search.addEventListener('input',()=>{
      const value=search.value.trim().toLowerCase();
      for(const button of Array.from(menu.children)){
        if(!button.dataset?.effect)continue;
        const data=ANIMATED_MESSAGE_EFFECTS[button.dataset.effect];
        button.classList.toggle('hidden',
          !!value&&!data?.label.toLowerCase().includes(value));
      }
    });
    node.append(menu);
    choice={messageId,element:menu};
  }
  async function trigger(messageId,effect){
    if(!current()||!EFFECT_NAMES.has(effect)||writes.has(messageId))return;
    if(!/^[A-Za-z0-9]{1,100}$/.test(messageId))return;
    const original=context,room=original.threadId;
    writes.add(messageId);
    try{
      const playId=doc(collection(db,'threads',room,'messageEffects')).id;
      await setDoc(doc(db,'threads',room,'messageEffects',messageId),{
        uid:original.uid,effect,playId,triggeredAt:serverTimestamp()
      });
    }catch(error){
      if(context===original&&current()){
        onStatus(error?.code==='permission-denied'
          ?'Animation was not shared. Publish the updated Firestore Rules or wait a second after sending.'
          :'Animation failed: '+(error?.message||'Try again'));
      }
    }finally{writes.delete(messageId)}
  }
  // Only messages that were explicitly sent WITH a selected animation
  // receive an Animate button. It appears about one second after the
  // Firestore-issued send timestamp, never on an unsaved local draft.
  // Clicking it fires a private replay event; nothing plays on Send.
  function decorate(meta,node,item,message){
    if(!current()||!item||!message||item.metadata?.hasPendingWrites||
       !validAnimatedMessageEffect(message.effect))return;
    const timestamp=message.createdAt?.toMillis?.();
    if(!Number.isFinite(timestamp)||!/^[A-Za-z0-9]{20}$/.test(item.id))return;
    const original=context,messageId=item.id,effect=message.effect;
    const button=document.createElement('button');
    button.type='button';
    button.className='effect-trigger';
    button.textContent='✨ Animate';
    button.title='Play '+ANIMATED_MESSAGE_EFFECTS[effect].label+
      ' around this message on BOTH phones';
    button.setAttribute('aria-label',button.title);
    button.onclick=()=>{
      if(!current()||context!==original||writes.has(messageId))return;
      dismiss();
      void trigger(messageId,effect);
    };
    const remaining=Math.max(0,timestamp+1000-Date.now());
    if(remaining>0)button.classList.add('hidden');
    meta.append(button);
    if(remaining>0){
      const timer=setTimeout(()=>{
        revealTimers.delete(timer);
        if(context===original&&current()&&node.isConnected)
          button.classList.remove('hidden');
      },remaining+30);
      revealTimers.add(timer);
    }
  }
  function close(){
    if(unsubscribe){unsubscribe();unsubscribe=null}
    context=null;firstServerSnapshot=false;openingReplayChecked=false;seen.clear();
    dismiss();clearTimers();queuedReplay.clear();
  }
  return {open,close,decorate,beforeMessagesRender,afterMessagesRender,observeMessages};
}
