import {
  collection,doc,onSnapshot,orderBy,query,limit,setDoc,serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

// A single validated signal document replays an effect around ONE chat
// message on both devices. Never changes message text, reactions, reply,
// delivery/seen timestamps or any unrelated mini-game/doodle collections.
export const MESSAGE_EFFECTS=[
  {id:'confetti',emoji:'🎉',label:'Confetti'},
  {id:'fireworks',emoji:'🎆',label:'Fireworks'},
  {id:'sparkles',emoji:'✨',label:'Sparkles'},
  {id:'hearts',emoji:'💖',label:'Hearts'}
];
const EFFECT_NAMES=new Set(MESSAGE_EFFECTS.map(effect=>effect.id));

export function createMessageEffectsController({db,getContext,onStatus}){
  const messages=document.getElementById('messages');
  let context=null,unsubscribe=null,firstServerSnapshot=false;
  let seen=new Map(),revealTimers=new Set(),choice=null;
  let writes=new Set(),burstTimers=new Set();
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
  function play(messageId,effect){
    if(!current()||!EFFECT_NAMES.has(effect))return;
    const target=Array.from(messages.children).find(node=>
      node.dataset?.messageId===messageId);
    if(!target)return;
    target.querySelector('.message-effect-burst')?.remove();
    const burst=document.createElement('div');
    burst.className='message-effect-burst effect-'+effect;
    burst.setAttribute('aria-hidden','true');
    const glyph=effect==='confetti'?'◆':
      effect==='fireworks'?'✦':effect==='hearts'?'💖':'✨';
    for(let i=0;i<14;i++){
      const particle=document.createElement('span');
      particle.className='message-effect-particle';
      particle.textContent=glyph;
      const angle=(i*137.5+20)*Math.PI/180;
      const distance=56+(i%4)*17;
      particle.style.setProperty('--dx',Math.round(Math.cos(angle)*distance)+'px');
      particle.style.setProperty('--dy',Math.round(Math.sin(angle)*distance)+'px');
      particle.style.setProperty('--spin',(i%2?1:-1)*(95+(i%4)*70)+'deg');
      particle.style.setProperty('--wait',(i%4)*50+'ms');
      burst.append(particle);
    }
    target.append(burst);
    const timer=setTimeout(()=>{
      burst.remove();
      burstTimers.delete(timer);
    },1750);
    burstTimers.add(timer);
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
      play(item.id,data.effect);
    }
    firstServerSnapshot=true;
  }
  function open(threadId,uid){
    close();
    if(!threadId||!uid)return;
    context={threadId,uid};
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
    menu.setAttribute('aria-label','Choose a message animation');
    const label=document.createElement('span');
    label.className='message-effect-menu-label';
    label.textContent='Animate this message';
    menu.append(label);
    for(const effect of MESSAGE_EFFECTS){
      const button=document.createElement('button');
      button.type='button';
      button.className='message-effect-choice';
      button.textContent=effect.emoji+' '+effect.label;
      button.setAttribute('aria-label','Play '+effect.label+' on both phones');
      button.onclick=event=>{
        event.stopPropagation();
        dismiss();
        void trigger(messageId,effect.id);
      };
      menu.append(button);
    }
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
  function decorate(meta,node,item,message){
    if(!current()||!item||!message||item.metadata?.hasPendingWrites)return;
    const timestamp=message.createdAt?.toMillis?.();
    if(!Number.isFinite(timestamp))return;
    const messageId=item.id,original=context;
    const button=document.createElement('button');
    button.type='button';
    button.className='effect-trigger';
    button.textContent='✨ Animate';
    button.title='Animate this message for both friends';
    button.setAttribute('aria-label','Animate message for both friends');
    const remaining=Math.max(0,timestamp+1000-Date.now());
    const options=document.createElement('button');
    options.type='button';
    options.className='effect-options';
    options.textContent='▾';
    options.title='Choose another animation';
    options.setAttribute('aria-label','Choose Confetti, Fireworks, Sparkles or Hearts');
    // One tap on Animate always launches the default shared Confetti effect.
    // The small adjacent arrow is for choosing another effect.
    button.onclick=()=>{dismiss();void trigger(messageId,'confetti')};
    options.onclick=()=>showChoices(node,messageId);
    if(remaining>0){
      button.classList.add('hidden');
      options.classList.add('hidden');
    }
    meta.append(button,options);
    if(remaining>0){
      const timer=setTimeout(()=>{
        revealTimers.delete(timer);
        if(context===original&&current()&&node.isConnected){
          button.classList.remove('hidden');
          options.classList.remove('hidden');
        }
      },remaining+30);
      revealTimers.add(timer);
    }
  }
  function close(){
    if(unsubscribe){unsubscribe();unsubscribe=null}
    context=null;firstServerSnapshot=false;seen.clear();
    dismiss();clearTimers();
    for(const timer of burstTimers)clearTimeout(timer);
    burstTimers.clear();
    messages.querySelectorAll('.message-effect-burst').forEach(node=>node.remove());
  }
  return {open,close,decorate,beforeMessagesRender};
}
