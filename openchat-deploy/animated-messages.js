// Animated private messages, built from safe local DOM and CSS animations.
// Only four server-allowlisted effect names are ever sent to Firestore.
// The effect is part of the original message, not a separate document.
export const ANIMATED_MESSAGE_EFFECTS=Object.freeze({
  confetti:{label:'Confetti',icon:'🎉',particles:['🎉','🎊','✨','🔸','💛']},
  fireworks:{label:'Fireworks',icon:'🎆',particles:['🎆','✨','🌟','💥','⭐']},
  sparkles:{label:'Sparkles',icon:'✨',particles:['✨','🌟','⭐','💫']},
  hearts:{label:'Hearts',icon:'💖',particles:['💖','💕','💗','💝','❤️']}
});

const SPREAD=[
  [-82,-105],[-43,-115],[13,-126],[70,-114],[110,-56],[94,8],
  [59,82],[-5,99],[-72,83],[-105,16],[-55,-35],[36,-42]
];
const PLAY_WINDOW_MS=45000;
const MAX_PER_UPDATE=3;
export function validAnimatedMessageEffect(name){
  return typeof name==='string' &&
    Object.prototype.hasOwnProperty.call(ANIMATED_MESSAGE_EFFECTS,name);
}
export function effectIsFresh(message,now=Date.now()){
  const sentAt=message?.createdAt?.toMillis?.();
  return typeof sentAt==='number' && Number.isFinite(sentAt) &&
    sentAt<=now+5000 && now-sentAt>=-5000 &&
    now-sentAt<=PLAY_WINDOW_MS;
}

export function createAnimatedMessagesController(){
  const $=id=>document.getElementById(id);
  const toggle=$('effectToggleBtn'),picker=$('effectPicker');
  const options=$('effectOptions'),hint=$('effectHint');
  let selected='',threadId=null,known=new Set(),initialized=false;
  let playingUntil=new Map();

  function updateSelection(){
    const data=ANIMATED_MESSAGE_EFFECTS[selected];
    toggle.textContent=data?data.icon+' '+data.label:'✨ Effects';
    toggle.setAttribute('aria-label',
      data?'Message effect: '+data.label+'. Change effect':'Choose a message effect');
    hint.textContent=data
      ?data.icon+' '+data.label+' will play when this message arrives.'
      :'';
    hint.classList.toggle('hidden',!data);
    for(const button of options.children){
      const enabled=button.dataset.effect===selected;
      button.setAttribute('aria-pressed',String(enabled));
      button.classList.toggle('selected',enabled);
    }
  }
  function closePicker(){
    picker.classList.add('hidden');
    toggle.setAttribute('aria-expanded','false');
  }
  function selectEffect(name){
    if(name!==''&&!validAnimatedMessageEffect(name))return;
    selected=name;
    updateSelection();
    closePicker();
  }
  const entries=[['','None','🚫'],...Object.entries(ANIMATED_MESSAGE_EFFECTS)
    .map(([name,data])=>[name,data.label,data.icon])];
  for(const [key,label,icon] of entries){
    const option=document.createElement('button');
    option.type='button';option.className='effect-choice';
    option.dataset.effect=key;
    option.textContent=icon+' '+label;
    option.title=key?'Send with '+label+' animation':'Send normally without animation';
    option.setAttribute('aria-label',option.title);
    option.setAttribute('aria-pressed','false');
    option.onclick=()=>selectEffect(key);
    options.append(option);
  }
  toggle.onclick=()=>{
    const next=picker.classList.contains('hidden');
    picker.classList.toggle('hidden',!next);
    toggle.setAttribute('aria-expanded',String(next));
  };
  picker.addEventListener('keydown',event=>{
    if(event.key==='Escape'){closePicker();toggle.focus()}
  });
  updateSelection();

  function beginChat(id){
    threadId=id;
    selected='';known=new Set();initialized=false;playingUntil.clear();
    updateSelection();closePicker();
  }
  function endChat(){
    threadId=null;
    selected='';known=new Set();initialized=false;playingUntil.clear();
    updateSelection();closePicker();
  }
  function currentEffect(){return validAnimatedMessageEffect(selected)?selected:''}
  function clearSentEffect(expected){
    if(selected===expected)selectEffect('');
  }

  // Track message document identity (not snapshot object identity).
  // Seen/read/edit/reaction snapshots recreate DOM; they must never replay
  // effects. Initial history never plays, and unverified/cache writes are
  // never treated as newly received messages.
  function observeSnapshot(snapshot){
    const arrivals=new Set();
    if(!threadId||!snapshot?.docs)return arrivals;
    // Bound burst tracking; notifications and reaction edits can produce
    // several snapshot events during a short animation.
    for(const [id,expiry] of playingUntil){
      if(expiry<=Date.now())playingUntil.delete(id);
    }
    if(!initialized){
      initialized=true;
      for(const item of snapshot.docs)known.add(item.id);
      return arrivals;
    }
    let triggered=0;
    for(const item of snapshot.docs){
      if(known.has(item.id))continue;
      const waiting=!!item.metadata?.hasPendingWrites;
      // A pending local write can play only after the server confirms it.
      if(waiting)continue;
      known.add(item.id);
      const message=item.data();
      if(triggered<MAX_PER_UPDATE && !snapshot.metadata?.fromCache &&
         validAnimatedMessageEffect(message?.effect) && effectIsFresh(message)){
        arrivals.add(item.id);
        triggered++;
      }
    }
    return arrivals;
  }

  function reducedMotion(){
    try{return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true}
    catch{return false}
  }
  function play(node,name){
    if(!node||!validAnimatedMessageEffect(name)||
       reducedMotion()||document.visibilityState==='hidden')return false;
    const existing=node.querySelector?.('.msg-effect-burst');
    if(existing)existing.remove();
    const layer=document.createElement('span');
    layer.className='msg-effect-burst msg-effect-'+name;
    layer.setAttribute('aria-hidden','true');
    const glyphs=ANIMATED_MESSAGE_EFFECTS[name].particles;
    for(let i=0;i<SPREAD.length;i++){
      const [x,y]=SPREAD[i];
      const particle=document.createElement('span');
      particle.className='msg-effect-particle';
      particle.textContent=glyphs[i%glyphs.length];
      particle.style.setProperty('--dx',x+'px');
      particle.style.setProperty('--dy',y+'px');
      particle.style.setProperty('--dx-early',Math.round(x*.24)+'px');
      particle.style.setProperty('--dy-early',Math.round(y*.24)+'px');
      particle.style.setProperty('--dx-middle',Math.round(x*.83)+'px');
      particle.style.setProperty('--dy-middle',Math.round(y*.83)+'px');
      particle.style.setProperty('--spin',((i%2===0?1:-1)*(i*31+26))+'deg');
      particle.style.setProperty('--delay',(i%4*65)+'ms');
      layer.append(particle);
    }
    node.append(layer);
    // Clean decorative DOM automatically even when the message is not
    // re-rendered. Clearing it does not mutate Firebase documents.
    setTimeout(()=>layer.remove(),2100);
    return true;
  }
  function decorateMessage(node,message,animate,id){
    if(!validAnimatedMessageEffect(message?.effect))return;
    const effect=message.effect;
    node.classList.add('has-message-effect');
    const data=ANIMATED_MESSAGE_EFFECTS[effect];
    const button=document.createElement('button');
    button.type='button';button.className='msg-effect-replay';
    button.textContent=data.icon+' '+data.label;
    button.title='Replay '+data.label+' animation';
    button.setAttribute('aria-label',button.title);
    button.onclick=()=>play(node,effect);
    node.append(button);
    if(animate && id)playingUntil.set(id,Date.now()+1750);
    if(animate || (id && (playingUntil.get(id)||0)>Date.now()))play(node,effect);
  }
  return {beginChat,endChat,currentEffect,clearSentEffect,
    observeSnapshot,decorateMessage,selectEffect,closePicker};
}
