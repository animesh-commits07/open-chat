// Safe, emoji-based animations that play automatically on newly sent and
// received private messages. Only immutable allowlisted effect IDs are stored.
// The original message document is the shared transport for automatic play;
// an independent per-message signal is used ONLY for manual shared replays.
export const ANIMATED_MESSAGE_EFFECTS=Object.freeze({
  confetti:{label:"Confetti",icon:"🎉",motion:"burst",particles:["🎉","🎊","🟨","🟣","✨"]},
  fireworks:{label:"Fireworks",icon:"🎆",motion:"burst",particles:["🎆","✨","💥","🌟","⭐"]},
  sparkles:{label:"Sparkles",icon:"✨",motion:"orbit",particles:["✨","✦","💫","⭐","🌟"]},
  hearts:{label:"Hearts",icon:"💖",motion:"float",particles:["💖","💕","💗","❤️","💝"]},
  balloons:{label:"Balloons",icon:"🎈",motion:"float",particles:["🎈","🎈","🎊","✨"]},
  snow:{label:"Snowfall",icon:"❄️",motion:"fall",particles:["❄️","❅","☃️","✨"]},
  rainbow:{label:"Rainbow",icon:"🌈",motion:"arc",particles:["🌈","❤️","🧡","💛","💚","💙","💜"]},
  stars:{label:"Star Shower",icon:"🌠",motion:"fall",particles:["⭐","🌟","✨","🌠"]},
  butterflies:{label:"Butterflies",icon:"🦋",motion:"flutter",particles:["🦋","🦋","✨","🌸"]},
  flowers:{label:"Flower Bloom",icon:"🌸",motion:"float",particles:["🌸","🌺","🌷","🌼","🌻"]},
  lightning:{label:"Thunder",icon:"⚡",motion:"flash",particles:["⚡","⚡","💥","✨"]},
  bubbles:{label:"Bubbles",icon:"🫧",motion:"float",particles:["🫧","🫧","💧","✨"]},
  party:{label:"Party Blast",icon:"🥳",motion:"burst",particles:["🥳","🎊","🎉","🎈","✨"]},
  meteors:{label:"Meteor Shower",icon:"☄️",motion:"shoot",particles:["☄️","🌠","✨","⭐"]},
  leaves:{label:"Autumn Leaves",icon:"🍁",motion:"fall",particles:["🍁","🍂","🌿","🍃"]},
  magic:{label:"Magic Spell",icon:"🪄",motion:"orbit",particles:["🪄","✨","🔮","💫","⭐"]},
  candy:{label:"Candy Rain",icon:"🍬",motion:"fall",particles:["🍬","🍭","🍫","🧁"]},
  rockets:{label:"Rocket Launch",icon:"🚀",motion:"shoot",particles:["🚀","🚀","✨","🔥"]},
  flames:{label:"Fire Burst",icon:"🔥",motion:"rise",particles:["🔥","🔥","💥","✨"]},
  disco:{label:"Disco Party",icon:"🪩",motion:"pulse",particles:["🪩","💃","🕺","✨","🎶"]},
  popcorn:{label:"Popcorn Pop",icon:"🍿",motion:"burst",particles:["🍿","🍿","✨","⭐"]},
  clouds:{label:"Dream Clouds",icon:"☁️",motion:"float",particles:["☁️","☁️","🌥️","✨"]},
  diamonds:{label:"Diamond Spark",icon:"💎",motion:"burst",particles:["💎","💠","✨","💎"]},
  ghosts:{label:"Cute Ghosts",icon:"👻",motion:"float",particles:["👻","👻","✨","🌙"]},
  cherry:{label:"Cherry Blossoms",icon:"🌸",motion:"fall",particles:["🌸","🌸","🌺","✨"]},
  ocean:{label:"Ocean Waves",icon:"🌊",motion:"wave",particles:["🌊","🐬","🐚","🫧"]},
  unicorn:{label:"Unicorn Magic",icon:"🦄",motion:"orbit",particles:["🦄","🌈","✨","💜"]},
  sunshine:{label:"Sunshine",icon:"☀️",motion:"glow",particles:["☀️","🌞","🌻","✨"]}
});

const AUTO_WINDOW_MS=45000;
const INITIAL_WINDOW_MS=9000;
const MAX_AUTOPLAY_PER_SNAPSHOT=3;
const FX_LIFETIME_MS=2200;
const MOTIONS=new Set(['burst','orbit','float','fall','arc','flutter',
  'flash','shoot','rise','pulse','wave','glow']);

export function validAnimatedMessageEffect(name){
  return typeof name==='string' &&
    Object.prototype.hasOwnProperty.call(ANIMATED_MESSAGE_EFFECTS,name);
}
export function effectIsFresh(message,now=Date.now(),windowMs=AUTO_WINDOW_MS){
  const timestamp=message?.createdAt?.toMillis?.();
  return typeof timestamp==='number' && Number.isFinite(timestamp) &&
    timestamp<=now+5000 && now-timestamp>=-5000 && now-timestamp<=windowMs;
}

export function createAnimatedMessagesController(){
  const $=id=>document.getElementById(id);
  const toggle=$('effectToggleBtn'),picker=$('effectPicker');
  const options=$('effectOptions'),hint=$('effectHint');
  const search=$('effectSearch');
  const sendError=$('effectSendError'),sendErrorText=$('effectSendErrorText');
  const errorDismiss=$('effectErrorDismiss');
  const messages=$('messages'),stage=$('conversationStage');
  let selected='',threadId=null,editing=false,initialized=false;
  let known=new Set(),autoplayed=new Set(),queuedSent=new Map();
  let effectsOnScreen=new Set(),timers=new Set();

  function updateSelection(){
    const data=ANIMATED_MESSAGE_EFFECTS[selected];
    toggle.textContent=data?data.icon+' '+data.label:'✨ Effects';
    toggle.setAttribute('aria-label',data
      ?'Message effect: '+data.label+'. Change effect'
      :'Choose an animated message effect');
    hint.textContent=data
      ?data.icon+' '+data.label+' plays automatically for BOTH friends on Send!'
      :'';
    hint.classList.toggle('hidden',!data);
    for(const option of options.children){
      const enabled=option.dataset.effect===selected;
      option.setAttribute('aria-pressed',String(enabled));
      option.classList.toggle('selected',enabled);
    }
  }
  function clearSendError(){
    sendErrorText.textContent='';
    sendError.classList.add('hidden');
  }
  function showSendError(problem){
    sendErrorText.textContent=problem?.code==='permission-denied'
      ?'Animated message NOT sent. Publish the updated Firestore Rules and retry.'
      :'Animated message was NOT sent. Check your connection and retry.';
    sendError.classList.remove('hidden');
  }
  errorDismiss.onclick=clearSendError;
  function closePicker(){
    picker.classList.add('hidden');
    toggle.setAttribute('aria-expanded','false');
  }
  function selectEffect(name){
    if(editing&&name!=='')return;
    if(name!==''&&!validAnimatedMessageEffect(name))return;
    selected=name;updateSelection();closePicker();
  }
  const entries=[['','None','🚫'],...Object.entries(ANIMATED_MESSAGE_EFFECTS)
    .map(([id,data])=>[id,data.label,data.icon])];
  for(const [key,label,icon] of entries){
    const button=document.createElement('button');
    button.type='button';button.className='effect-choice';
    button.dataset.effect=key;
    button.textContent=icon+' '+label;
    button.title=key?'Automatically play '+label+' on both phones when sent'
      :'Send without an animation';
    button.setAttribute('aria-label',button.title);
    button.setAttribute('aria-pressed','false');
    button.onclick=()=>selectEffect(key);
    options.append(button);
  }
  function filterEffects(){
    const value=(search?.value||'').trim().toLowerCase();
    for(const option of options.children){
      const effect=ANIMATED_MESSAGE_EFFECTS[option.dataset.effect];
      const label=effect?.label?.toLowerCase()||'none';
      option.classList.toggle('hidden',
        !!value&&!label.includes(value)&&!String(option.dataset.effect).includes(value));
    }
  }
  if(search)search.addEventListener('input',filterEffects);
  toggle.onclick=()=>{
    if(editing)return;
    const show=picker.classList.contains('hidden');
    picker.classList.toggle('hidden',!show);
    toggle.setAttribute('aria-expanded',String(show));
    if(show&&search){search.value='';filterEffects();}
  };
  picker.addEventListener('keydown',event=>{
    if(event.key==='Escape'){closePicker();toggle.focus()}
  });
  updateSelection();

  function clearScenes(){
    for(const timer of timers)clearTimeout(timer);
    timers.clear();
    for(const scene of effectsOnScreen)scene.remove();
    effectsOnScreen.clear();
  }
  function beginChat(id){
    clearScenes();
    threadId=id;selected='';editing=false;toggle.disabled=false;
    known=new Set();autoplayed=new Set();queuedSent.clear();initialized=false;
    updateSelection();closePicker();clearSendError();
  }
  function endChat(){
    clearScenes();
    threadId=null;selected='';editing=false;toggle.disabled=false;
    known=new Set();autoplayed=new Set();queuedSent.clear();initialized=false;
    updateSelection();closePicker();clearSendError();
  }
  function setEditing(value){
    editing=!!value;
    toggle.disabled=editing;
    if(editing)selectEffect('');
    closePicker();
  }
  function currentEffect(){
    return !editing&&validAnimatedMessageEffect(selected)?selected:'';
  }
  function clearSentEffect(expected){
    if(selected===expected)selectEffect('');
  }

  // New arrivals are only server-confirmed documents with a recent
  // serverTimestamp. Ignore cached history and locally pending writes.
  // Each message ID can autoplay once per open conversation. Reactions,
  // read ticks, edits and other snapshot rerenders never auto-trigger.
  // On first server load only messages from the last few seconds can play,
  // so opening an old chat does not explode historical effects.
  function observeSnapshot(snapshot){
    const arrivals=new Set();
    if(!threadId||!snapshot?.docs||snapshot.metadata?.fromCache)return arrivals;
    const first=!initialized;
    initialized=true;
    let count=0;
    for(const item of snapshot.docs){
      if(item.metadata?.hasPendingWrites)continue;
      if(known.has(item.id))continue;
      known.add(item.id);
      const message=item.data();
      const recent=effectIsFresh(message,Date.now(),
        first?INITIAL_WINDOW_MS:AUTO_WINDOW_MS);
      if(recent&&validAnimatedMessageEffect(message.effect)&&
         count<MAX_AUTOPLAY_PER_SNAPSHOT&&!autoplayed.has(item.id)){
        arrivals.add(item.id);count++;
      }
    }
    return arrivals;
  }

  function reducedMotion(){
    try{return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true}
    catch{return false}
  }
  function play(node,name){
    if(!node||!stage||!validAnimatedMessageEffect(name)||
       document.visibilityState==='hidden')return false;
    const data=ANIMATED_MESSAGE_EFFECTS[name];
    const box=node.getBoundingClientRect?.();
    const parent=stage.getBoundingClientRect?.();
    if(!box||!parent||!parent.width||!parent.height)return false;
    const centerX=Math.max(5,Math.min(parent.width-5,
      box.left-parent.left+box.width/2));
    const centerY=Math.max(5,Math.min(parent.height-5,
      box.top-parent.top+Math.min(box.height/2,70)));
    const scene=document.createElement('span');
    scene.className='chat-fx-scene chat-fx-'+name+' chat-fx-motion-'+data.motion;
    scene.setAttribute('aria-hidden','true');
    scene.style.left=centerX+'px';
    scene.style.top=centerY+'px';
    const gentler=reducedMotion();
    const n=gentler?1:18;
    for(let i=0;i<n;i++){
      const p=document.createElement('span');
      p.className='chat-fx-particle';
      p.textContent=data.particles[i%data.particles.length];
      const theta=(i*137.508+17)*Math.PI/180;
      const radius=64+(i%5)*20;
      let dx=Math.cos(theta)*radius,dy=Math.sin(theta)*radius;
      if(data.motion==='float'||data.motion==='rise'){
        dx=(i%2?-1:1)*(16+(i*29)%95);
        dy=-65-(i*13)%110;
      }else if(data.motion==='fall'){
        dx=(i%2?-1:1)*(20+(i*23)%108);
        dy=65+(i*19)%110;
      }else if(data.motion==='shoot'){
        dx=-95+(i%7)*32;dy=-90-(i*13)%75;
      }else if(data.motion==='arc'){
        dx=(i-8.5)*17;dy=-Math.sin(i/18*Math.PI)*130;
      }else if(data.motion==='wave'){
        dx=(i-8.5)*17;dy=Math.sin(i*.95)*52-18;
      }else if(data.motion==='flash'||data.motion==='pulse'||
               data.motion==='glow'){
        dx=Math.cos(theta)*(24+(i%4)*26);
        dy=Math.sin(theta)*(24+(i%4)*26);
      }
      p.style.setProperty('--fx-x',Math.round(dx)+'px');
      p.style.setProperty('--fx-y',Math.round(dy)+'px');
      p.style.setProperty('--fx-mid-x',Math.round(dx*.42)+'px');
      p.style.setProperty('--fx-mid-y',Math.round(dy*.42)+'px');
      p.style.setProperty('--fx-outer-x',Math.round(dx*.83)+'px');
      p.style.setProperty('--fx-outer-y',Math.round(dy*.83)+'px');
      p.style.setProperty('--fx-half-x',Math.round(dx*.5)+'px');
      p.style.setProperty('--fx-spin',((i%2===0?1:-1)*(i*31+38))+'deg');
      p.style.setProperty('--fx-delay',(i%6)*44+'ms');
      p.style.setProperty('--fx-size',(17+(i%4)*4)+'px');
      scene.append(p);
    }
    if(gentler)scene.classList.add('chat-fx-reduced');
    stage.append(scene);effectsOnScreen.add(scene);
    const timer=setTimeout(()=>{
      scene.remove();effectsOnScreen.delete(scene);timers.delete(timer);
    },FX_LIFETIME_MS);
    timers.add(timer);
    return true;
  }
  function playMessage(messageId,effect){
    if(!threadId||!validAnimatedMessageEffect(effect))return false;
    const node=Array.from(messages.children).find(el=>
      el.dataset?.messageId===messageId);
    return !!node&&play(node,effect);
  }
  function markAutoplay(id,effect){
    if(autoplayed.has(id))return;
    if(playMessage(id,effect)){autoplayed.add(id);queuedSent.delete(id)}
  }
  // Firestore's addDoc promise may resolve after the UI snapshot or before
  // the matching bubble is mounted. Both cases cause one single autoplay.
  function confirmSentMessage(thread,id,effect){
    if(threadId!==thread||!validAnimatedMessageEffect(effect)||!id)return;
    queuedSent.set(id,effect);
    markAutoplay(id,effect);
  }
  function decorateMessage(node,message,animate,id){
    if(!validAnimatedMessageEffect(message?.effect))return;
    node.classList.add('has-message-effect');
    node.dataset.effect=message.effect;
    if(!id)return;
    if(animate||queuedSent.get(id)===message.effect){
      markAutoplay(id,message.effect);
    }
  }
  return {beginChat,endChat,setEditing,currentEffect,clearSentEffect,
    observeSnapshot,decorateMessage,confirmSentMessage,playMessage,
    selectEffect,closePicker,showSendError,clearSendError};
}
