import {
  collection,doc,onSnapshot,query,orderBy,limit,runTransaction,setDoc,serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

// One shared transparent drawing layer OVER a private conversation. Each
// session has an immutable timestamped stroke stream; chat stays visible.
// Nothing here touches messages,
// existing mini games, typing, presence or push subscriptions.
const PALETTE=['#263548','#ff6b6b','#29aa85','#6e62e5','#f7ad30'];
const ERASER='#ffffff';
const MAX_SEGMENTS=200,MAX_PENDING=28,MAX_POINTS=25;
const SIZE_OPTIONS=[3,6,12];
const POINT_PATTERN=/^[0-9]{4},[0-9]{4}(;[0-9]{4},[0-9]{4}){0,24}$/;

export function encodeDoodlePoints(points){
  if(!Array.isArray(points)||points.length<1||points.length>MAX_POINTS)
    throw Error('Invalid stroke length');
  return points.map(point=>{
    if(!Array.isArray(point)||point.length!==2||
      !point.every(value=>Number.isInteger(value)&&value>=0&&value<=1000))
      throw Error('Invalid stroke coordinate');
    return point.map(value=>String(value).padStart(4,'0')).join(',');
  }).join(';');
}
export function decodeDoodlePoints(encoded){
  if(typeof encoded!=='string'||encoded.length>256||!POINT_PATTERN.test(encoded))
    return [];
  return encoded.split(';').map(pair=>
    pair.split(',').map(value=>Math.min(1000,Number(value))));
}

export function createLiveDoodleController({db,getContext}){
  const $=id=>document.getElementById(id);
  const launch=$('doodleLaunchBtn'),panel=$('doodlePanel'),closeBtn=$('doodleCloseBtn');
  const canvas=$('doodleCanvas'),overlay=$('doodleOverlay');
  const baseCtx=canvas.getContext('2d'),overlayCtx=overlay.getContext('2d');
  const colors=$('doodleColors'),sizes=$('doodleSizes');
  const clearBtn=$('doodleClearBtn'),eraserBtn=$('doodleEraserBtn');
  const status=$('doodleStatus'),errorEl=$('doodleError'),counter=$('doodleCounter');
  const gameClose=$('gameCloseBtn');
  let scope=null,roomRef=null,sessionId='',stopRoom=null,stopStrokes=null;
  let serverRoom=false,serverStrokes=false,initializing=false,clearing=false;
  let strokes=[],strokeDocCount=0,error='',open=false;
  let active=null,flushTimer=null,chosenColor=PALETTE[1],penSize=6,eraser=false;
  let pending=new Map(),queue=[],writing=0,listenerRevision=0,resizeObserver=null;
  const colorButtons=[],sizeButtons=[];

  const current=()=>{
    const ctx=getContext();
    return !!scope&&!!ctx&&ctx.threadId===scope.threadId&&
      ctx.uid===scope.uid&&ctx.friendUid===scope.friendUid;
  };
  const ready=()=>current()&&serverRoom&&serverStrokes&&!!sessionId;
  const makeSession=threadId=>
    doc(collection(db,'threads',threadId,'doodles','current','sessions')).id;
  const strokeCollection=(threadId,session)=>
    collection(db,'threads',threadId,'doodles','current','sessions',session,'strokes');
  const normalize=(value)=>Math.max(0,Math.min(1000,Math.round(value)));

  function warn(problem){
    error=problem?.code==='permission-denied'
      ?'Doodle not saved. Publish the latest Firestore security rules.'
      :'Doodle sync failed: '+(problem?.message||'Connection error');
    renderStatus();
  }
  function renderStatus(){
    const valid=current();
    errorEl.textContent=error;
    errorEl.classList.toggle('hidden',!error);
    clearBtn.disabled=!ready()||clearing;
    const full=strokeDocCount+pending.size>=MAX_SEGMENTS;
    counter.textContent=(strokeDocCount||0)+'/'+MAX_SEGMENTS+' synced segments';
    if(!valid)status.textContent='Open a private conversation to draw.';
    else if(initializing)status.textContent='Preparing shared canvas…';
    else if(!serverRoom||!serverStrokes)status.textContent=
      error?'Connection needs attention':'Connecting to live canvas…';
    else if(clearing)status.textContent='Clearing canvas for both players…';
    else if(full)status.textContent='Canvas full. Use Clear Canvas to start a new round.';
    else if(pending.size)status.textContent='Drawing live · Syncing '+pending.size+' segment(s)…';
    else status.textContent='Live with @'+(scope.friendName||'friend')+' · Draw together!';
    canvas.classList.toggle('is-waiting',!ready());
    overlay.classList.toggle('is-waiting',!ready());
  }
  function drawPoints(ctx,points,color,size){
    if(!ctx||!points.length)return;
    ctx.save();
    ctx.lineCap='round';ctx.lineJoin='round';
    // Eraser removes only doodle ink, never the underlying chat messages.
    ctx.globalCompositeOperation=color===ERASER?'destination-out':'source-over';
    ctx.lineWidth=size;ctx.strokeStyle=color;ctx.fillStyle=color;
    if(points.length===1){
      const [x,y]=points[0];
      ctx.beginPath();ctx.arc(x,y,size/2,0,Math.PI*2);ctx.fill();
    }else{
      ctx.beginPath();ctx.moveTo(points[0][0],points[0][1]);
      for(let i=1;i<points.length;i++)ctx.lineTo(points[i][0],points[i][1]);
      ctx.stroke();
    }
    ctx.restore();
  }
  function configureCanvas(target){
    const ratio=Math.min(2,Math.max(1,window.devicePixelRatio||1));
    const bounds=target.getBoundingClientRect();
    const width=Math.max(1,Math.round(bounds.width*ratio));
    const height=Math.max(1,Math.round(bounds.height*ratio));
    if(target.width!==width)target.width=width;
    if(target.height!==height)target.height=height;
    const ctx=target.getContext('2d');
    ctx.setTransform(width/1000,0,0,height/1000,0,0);
  }
  function resize(){
    if(!scope)return;
    configureCanvas(canvas);configureCanvas(overlay);
    redrawBase();redrawOverlay();
  }
  function redrawBase(){
    if(!baseCtx||!canvas.width)return;
    // Keep the original conversation visible under the transparent ink.
    baseCtx.clearRect(0,0,1000,1000);
    for(const stroke of strokes){
      const data=stroke.data();
      drawPoints(baseCtx,decodeDoodlePoints(data.points),data.color,data.size);
    }
  }
  function redrawOverlay(){
    if(!overlayCtx||!overlay.width)return;
    overlayCtx.clearRect(0,0,1000,1000);
    // Compose confirmed + unconfirmed marks onto one visible transparent layer.
    // This also lets an in-progress eraser immediately remove existing marks.
    if(canvas.width&&canvas.height)overlayCtx.drawImage(canvas,0,0,1000,1000);
    for(const item of pending.values()){
      if(item.session===sessionId)
        drawPoints(overlayCtx,item.points,item.color,item.size);
    }
    if(active)drawPoints(overlayCtx,active.points,active.color,active.size);
  }
  function updateTools(){
    for(let i=0;i<colorButtons.length;i++){
      const chosen=!eraser&&chosenColor===PALETTE[i];
      colorButtons[i].setAttribute('aria-pressed',String(chosen));
      colorButtons[i].classList.toggle('selected',chosen);
    }
    for(let i=0;i<sizeButtons.length;i++){
      const chosen=!eraser&&penSize===SIZE_OPTIONS[i];
      sizeButtons[i].setAttribute('aria-pressed',String(chosen));
      sizeButtons[i].classList.toggle('selected',chosen);
    }
    eraserBtn.setAttribute('aria-pressed',String(eraser));
    eraserBtn.classList.toggle('selected',eraser);
  }
  for(const color of PALETTE){
    const item=document.createElement('button');
    item.type='button';item.className='doodle-color';
    item.style.backgroundColor=color;
    item.title='Brush '+color;
    item.setAttribute('aria-label','Choose color '+color);
    item.onclick=()=>{chosenColor=color;eraser=false;updateTools()};
    colors.append(item);colorButtons.push(item);
  }
  for(const size of SIZE_OPTIONS){
    const item=document.createElement('button');
    item.type='button';item.className='doodle-size';
    item.textContent=size===3?'Thin':size===6?'Medium':'Bold';
    item.onclick=()=>{penSize=size;eraser=false;updateTools()};
    sizes.append(item);sizeButtons.push(item);
  }
  eraserBtn.onclick=()=>{eraser=true;updateTools()};
  updateTools();

  function endActivePointer(event){
    if(!active|| (event && event.pointerId!==active.pointerId))return;
    if(event){
      const point=position(event);
      if(point && !samePoint(active.points[active.points.length-1],point))
        active.points.push(point);
    }
    flushActive(true);
    active=null;
    if(flushTimer!==null){clearInterval(flushTimer);flushTimer=null}
    redrawOverlay();
  }
  const samePoint=(a,b)=>!!a&&a[0]===b[0]&&a[1]===b[1];
  function position(event){
    const box=overlay.getBoundingClientRect();
    if(!box.width||!box.height)return null;
    return [normalize((event.clientX-box.left)/box.width*1000),
      normalize((event.clientY-box.top)/box.height*1000)];
  }
  function flushActive(final=false){
    if(!active||!active.points.length)return;
    if(!final&&active.points.length<2)return;
    // A final pointerup immediately after a timer flush should not create
    // an extra one-point duplicate document for the previous anchor.
    if(final&&active.points.length===1&&active.segmentsSent>0)return;
    const points=active.points.slice();
    if(points.length>MAX_POINTS){
      // Every segment is bounded even if one pointer event was delayed.
      const first=points.slice(0,MAX_POINTS);
      active.points=points.slice(MAX_POINTS-1);
      enqueue(first,active.color,active.size);
      if(final)flushActive(true);
      return;
    }
    active.points=final?[]:[points[points.length-1]];
    enqueue(points,active.color,active.size);
    active.segmentsSent++;
    redrawOverlay();
  }
  function enqueue(points,color,size){
    if(!ready()||!points.length)return;
    if(strokeDocCount+pending.size>=MAX_SEGMENTS||
       pending.size>=MAX_PENDING){
      error='Canvas is full or waiting for network. Let strokes sync or clear the canvas.';
      renderStatus();return;
    }
    const id=doc(strokeCollection(scope.threadId,sessionId));
    const original=scope;
    const packet={ref:id,uid:scope.uid,color,size,
      points:encodeDoodlePoints(points),session:sessionId,original};
    pending.set(id.id,{session:sessionId,points,color,size});
    queue.push(packet);
    redrawOverlay();renderStatus();pump();
  }
  function pump(){
    while(writing<2&&queue.length){
      const packet=queue.shift();
      writing++;
      Promise.resolve().then(()=>setDoc(packet.ref,{
        uid:packet.uid,color:packet.color,size:packet.size,
        points:packet.points,createdAt:serverTimestamp()
      })).catch(problem=>{
        if(scope===packet.original&&sessionId===packet.session){
          pending.delete(packet.ref.id);warn(problem);redrawOverlay();
        }
      }).finally(()=>{
        writing--;
        pump();
      });
    }
  }
  function onPointerDown(event){
    if(event.pointerType==='mouse'&&event.button!==0)return;
    if(active||!ready()||clearing)return;
    if(strokeDocCount+pending.size>=MAX_SEGMENTS){
      renderStatus();return;
    }
    const point=position(event);if(!point)return;
    event.preventDefault();
    overlay.setPointerCapture?.(event.pointerId);
    active={pointerId:event.pointerId,
      color:eraser?ERASER:chosenColor,
      size:eraser?24:penSize,points:[point],segmentsSent:0};
    redrawOverlay();
    if(flushTimer!==null)clearInterval(flushTimer);
    flushTimer=setInterval(()=>flushActive(false),130);
  }
  function onPointerMove(event){
    if(!active||event.pointerId!==active.pointerId)return;
    const point=position(event);
    if(!point)return;
    event.preventDefault();
    const previous=active.points[active.points.length-1];
    if(previous&&Math.hypot(point[0]-previous[0],point[1]-previous[1])<3)return;
    active.points.push(point);
    if(active.points.length>=MAX_POINTS)flushActive(false);
    redrawOverlay();
  }
  overlay.addEventListener('pointerdown',onPointerDown);
  overlay.addEventListener('pointermove',onPointerMove);
  overlay.addEventListener('pointerup',endActivePointer);
  overlay.addEventListener('pointercancel',endActivePointer);
  overlay.addEventListener('lostpointercapture',endActivePointer);

  async function ensureRoom(original){
    if(initializing)return;
    initializing=true;renderStatus();
    const ref=roomRef;
    try{
      await runTransaction(db,async tx=>{
        const existing=await tx.get(ref);
        if(!existing.exists())tx.set(ref,{
          session:makeSession(original.threadId),
          createdAt:serverTimestamp(),updatedAt:serverTimestamp()
        });
      });
    }catch(problem){if(scope===original)warn(problem)}
    finally{if(scope===original){initializing=false;renderStatus()}}
  }
  function watchStrokes(session,original){
    if(stopStrokes){stopStrokes();stopStrokes=null}
    serverStrokes=false;strokes=[];strokeDocCount=0;
    // A cleared board invalidates all previews from the previous session.
    active=null;if(flushTimer!==null){clearInterval(flushTimer);flushTimer=null}
    pending.clear();
    queue=queue.filter(job=>job.original!==original||job.session===session);
    redrawBase();redrawOverlay();renderStatus();
    const revision=++listenerRevision;
    const col=strokeCollection(original.threadId,session);
    stopStrokes=onSnapshot(query(col,orderBy('createdAt','desc'),
        limit(MAX_SEGMENTS)),{includeMetadataChanges:true},
      snapshot=>{
        if(!current()||scope!==original||sessionId!==session||
          revision!==listenerRevision)return;
        serverStrokes=!snapshot.metadata.fromCache;
        strokes=snapshot.docs.slice().reverse();
        strokeDocCount=snapshot.size;
        for(const item of snapshot.docs){
          if(!snapshot.metadata.fromCache && !item.metadata.hasPendingWrites)
            pending.delete(item.id);
        }
        redrawBase();redrawOverlay();renderStatus();
      },problem=>{
        if(scope!==original||!current()||sessionId!==session)return;
        serverStrokes=false;warn(problem);
      });
  }
  function handleRoomSnapshot(snapshot,original){
    if(scope!==original||!current())return;
    serverRoom=!snapshot.metadata.fromCache;
    if(!snapshot.exists()){
      if(serverRoom&&open)void ensureRoom(original);
      renderStatus();return;
    }
    const next=snapshot.data()?.session;
    if(typeof next!=='string'||!/^[A-Za-z0-9]{20}$/.test(next)){
      error='Invalid shared canvas state.';serverRoom=false;renderStatus();return;
    }
    if(sessionId!==next){
      sessionId=next;
      error='';
      watchStrokes(next,original);
    }
    renderStatus();
  }
  async function clearCanvas(){
    if(!ready()||clearing)return;
    if(!window.confirm('Clear this shared canvas for BOTH friends? Drawings in this round will no longer be shown.'))return;
    endActivePointer();
    const original=scope,ref=roomRef,expected=sessionId;
    clearing=true;error='';renderStatus();
    try{
      await runTransaction(db,async tx=>{
        const snap=await tx.get(ref);
        if(!snap.exists()||snap.data().session!==expected)
          throw Error('Canvas already changed. Please try again.');
        tx.update(ref,{session:makeSession(original.threadId),
          updatedAt:serverTimestamp()});
      });
    }catch(problem){if(scope===original)warn(problem)}
    finally{if(scope===original){clearing=false;renderStatus()}}
  }
  clearBtn.onclick=()=>{void clearCanvas()};
  function close(){
    endActivePointer();
    if(stopStrokes){stopStrokes();stopStrokes=null}
    if(stopRoom){stopRoom();stopRoom=null}
    if(resizeObserver){resizeObserver.disconnect();resizeObserver=null}
    window.removeEventListener('resize',resize);
    ++listenerRevision;
    scope=null;roomRef=null;sessionId='';serverRoom=false;serverStrokes=false;
    initializing=false;clearing=false;strokes=[];strokeDocCount=0;
    pending.clear();active=null;error='';open=false;
    // Never briefly display a previous friend's private drawing after a
    // conversation switch; canvas pixels outlive the DOM panel otherwise.
    redrawBase();redrawOverlay();
    panel.classList.add('hidden');
    panel.classList.remove('is-viewing');
    launch.setAttribute('aria-expanded','false');
    launch.setAttribute('aria-pressed','false');
    renderStatus();
  }
  // Viewer mode is always visible over the chat, but never blocks
  // scrolling, typing, reacting, or tapping messages. Only the Draw button
  // switches on touch capture and the floating brush controls.
  function connect(threadId,uid,friendUid,friendName='friend'){
    if(!threadId||!uid||!friendUid)return;
    close();
    scope={threadId,uid,friendUid,friendName};
    open=false;
    roomRef=doc(db,'threads',threadId,'doodles','current');
    panel.classList.remove('hidden');
    panel.classList.add('is-viewing');
    renderStatus();
    resize();
    if(typeof ResizeObserver!=='undefined'){
      resizeObserver=new ResizeObserver(resize);
      resizeObserver.observe(canvas);
    }
    window.addEventListener('resize',resize);
    const original=scope;
    stopRoom=onSnapshot(roomRef,{includeMetadataChanges:true},
      snapshot=>handleRoomSnapshot(snapshot,original),
      problem=>{if(scope!==original||!current())return;
        serverRoom=false;serverStrokes=false;warn(problem)});
  }
  function stopDrawing(){
    if(!scope)return;
    endActivePointer();
    open=false;
    panel.classList.add('is-viewing');
    launch.setAttribute('aria-expanded','false');
    launch.setAttribute('aria-pressed','false');
    renderStatus();
  }
  function openDoodle(){
    const context=getContext();
    if(!context?.threadId||!context.uid||!context.friendUid)return;
    if(!scope||!current())connect(context.threadId,context.uid,context.friendUid,
      context.friendName||'friend');
    if(!current())return;
    open=true;
    panel.classList.remove('is-viewing');
    launch.setAttribute('aria-expanded','true');
    launch.setAttribute('aria-pressed','true');
    gameClose.click();
    renderStatus();
    resize();
    // Avoid creating Firestore documents for chats nobody ever doodled in.
    // A room is created only when somebody actually starts drawing.
    if(serverRoom&&!sessionId&&!initializing)void ensureRoom(scope);
  }
  launch.onclick=()=>{if(open)stopDrawing();else openDoodle()};
  closeBtn.onclick=stopDrawing;
  panel.addEventListener('keydown',event=>{if(event.key==='Escape')stopDrawing()});
  return {open:openDoodle,connect,exit:stopDrawing,close};
}
