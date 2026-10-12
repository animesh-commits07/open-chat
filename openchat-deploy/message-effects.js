// Decorative animations only. The message text, receipt and reaction
// documents stay unchanged except for a whitelisted optional 'effect' field.
// All particles are created from known local constants: never HTML from chat.
export const MESSAGE_EFFECTS=Object.freeze({
  confetti:{label:'Confetti',icon:'🎉',count:28},
  fireworks:{label:'Fireworks',icon:'🎆',count:30},
  sparkles:{label:'Sparkles',icon:'✨',count:20},
  hearts:{label:'Hearts',icon:'💖',count:18}
});
export function normalizeMessageEffect(value){
  return typeof value==='string' && Object.prototype.hasOwnProperty.call(MESSAGE_EFFECTS,value)
    ?value:'';
}

export function createMessageEffectsController({layer}){
  const bursts=new Set();
  const clamp=(num,min,max)=>Math.min(max,Math.max(min,num));
  function clearBurst(item){
    if(!bursts.has(item))return;
    clearTimeout(item.timer);
    item.element.remove();
    item.bubble?.classList.remove('message-effect-pulse');
    bursts.delete(item);
  }
  function reset(){
    for(const item of [...bursts])clearBurst(item);
    layer.replaceChildren();
  }
  function play(effect,bubble){
    const normalized=normalizeMessageEffect(effect);
    if(!normalized||!bubble||!layer)return false;
    // Respect accessibility preferences: keep the visible effect label but
    // don't play motion for people who requested reduced animation.
    if(typeof window!=='undefined' && typeof window.matchMedia==='function' &&
       window.matchMedia('(prefers-reduced-motion: reduce)').matches)return false;

    const viewport=layer.getBoundingClientRect();
    const anchor=bubble.getBoundingClientRect();
    if(viewport.width<=0||viewport.height<=0||anchor.bottom<viewport.top||
       anchor.top>viewport.bottom)return false;
    const cx=clamp(anchor.left+anchor.width/2-viewport.left,12,viewport.width-12);
    const cy=clamp(anchor.top+anchor.height/2-viewport.top,12,viewport.height-12);
    while(bursts.size>=2)clearBurst(bursts.values().next().value);
    const group=document.createElement('div');
    group.className='message-effect-burst';
    group.setAttribute('aria-hidden','true');
    const profile=MESSAGE_EFFECTS[normalized];
    const signs=normalized==='hearts'?['♥','💕','💖']:
      normalized==='sparkles'?['✦','✧','✨']:
      normalized==='fireworks'?['✶','✷','✹','✦']:
      ['▮','◆','●','✦'];
    const colors=['#ffdd57','#ff7cb3','#4ce5cf','#b9a4ff','#ff945a','#f6faff'];
    for(let i=0;i<profile.count;i++){
      const piece=document.createElement('span');
      piece.className='message-effect-particle message-effect-'+normalized;
      piece.textContent=signs[i%signs.length];
      const angle=2*Math.PI*(i/profile.count)+(Math.random()-.5)*.33;
      const length=(normalized==='hearts'?100:normalized==='sparkles'?135:180)*
        (.5+Math.random()*.65);
      const dx=Math.cos(angle)*length;
      const dy=normalized==='hearts'?-45-Math.random()*180:
        Math.sin(angle)*length;
      piece.style.left=cx+'px';
      piece.style.top=cy+'px';
      piece.style.color=colors[i%colors.length];
      piece.style.setProperty('--effect-x',dx.toFixed(1)+'px');
      piece.style.setProperty('--effect-y',dy.toFixed(1)+'px');
      piece.style.setProperty('--effect-rotate',Math.round((Math.random()-.5)*720)+'deg');
      piece.style.setProperty('--effect-delay',(i%7*43)+'ms');
      piece.style.setProperty('--effect-duration',(1500+Math.round(Math.random()*550))+'ms');
      group.append(piece);
    }
    layer.append(group);
    bubble.classList.add('message-effect-pulse');
    const item={element:group,bubble,timer:null};
    bursts.add(item);
    item.timer=setTimeout(()=>clearBurst(item),2500);
    return true;
  }
  return{play,reset};
}
