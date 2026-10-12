import {doc,FieldPath,onSnapshot,runTransaction,serverTimestamp}
  from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

// Private two-player quiz. Kept separate from existing Tic-Tac-Toe invitations,
// messages, presence, reactions, typing, receipts and push subscriptions.
export const QUICK_QUIZ_QUESTIONS=[
  {text:'Which planet is called the Red Planet?',options:['Venus','Mars','Jupiter','Saturn'],answer:1},
  {text:'How many sides does a hexagon have?',options:['5','6','7','8'],answer:1},
  {text:'Which is the tallest land animal?',options:['Giraffe','Elephant','Lion','Zebra'],answer:0},
  {text:'What is the capital of Japan?',options:['Seoul','Beijing','Bangkok','Tokyo'],answer:3},
  {text:'What comes next: 2, 4, 8, 16, …?',options:['18','32','24','20'],answer:1}
];
export function quizCompleted(answers,uid){
  const own=answers?.[uid];
  return !!own && typeof own==='object' &&
    Object.keys(own).length===QUICK_QUIZ_QUESTIONS.length;
}
export function quickQuizScore(answers,uid){
  const own=answers?.[uid]||{};
  return QUICK_QUIZ_QUESTIONS.reduce((total,q,index)=>
    total+(own[String(index)]===q.answer?1:0),0);
}
export function createQuickQuizController({db,getContext}){
  const $=id=>document.getElementById(id);
  const panel=$('quizPanel'),launcher=$('quizLaunchBtn');
  const body=$('quizBody'),errorEl=$('quizError'),closeBtn=$('quizCloseBtn');
  const gameClose=$('gameCloseBtn');
  let scope=null,ref=null,unsubscribe=null,quiz=null,confirmed=false;
  let busy=false,error='',opened=false;
  const el=(tag,cls,text)=>{
    const n=document.createElement(tag);
    if(cls)n.className=cls;
    if(text!==undefined)n.textContent=text;
    return n;
  };
  const current=()=>{
    const ctx=getContext();
    return !!scope && !!ctx && scope.threadId===ctx.threadId &&
      scope.uid===ctx.uid && scope.friendUid===ctx.friendUid;
  };
  function isFinished(data){
    return quizCompleted(data?.answers,scope.uid) &&
      quizCompleted(data?.answers,scope.friendUid);
  }
  function canRestart(data){
    const last=data?.updatedAt?.toMillis?.()||0;
    return isFinished(data)||(last>0 && Date.now()-last>=3600000);
  }
  function close(){
    if(unsubscribe){unsubscribe();unsubscribe=null}
    scope=null;ref=null;quiz=null;confirmed=false;busy=false;error='';opened=false;
    panel.classList.add('hidden');body.replaceChildren();
    launcher.setAttribute('aria-expanded','false');
  }
  function render(){
    if(!opened||!current())return;
    body.replaceChildren();
    errorEl.textContent=error;
    errorEl.classList.toggle('hidden',!error);
    if(!confirmed){
      body.append(el('p','quiz-hint',error?'Quiz sync unavailable.':'Connecting to private quiz…'));
      return;
    }
    if(!quiz){
      const start=el('button','quiz-primary','Start five-question quiz');
      start.type='button';start.disabled=busy;
      start.onclick=()=>{void startQuiz()};
      body.append(el('p','quiz-hint','Both players answer five fun questions on their own device.'));
      body.append(start);return;
    }
    const mine=quiz.answers?.[scope.uid]||{};
    const theirs=quiz.answers?.[scope.friendUid]||{};
    const index=Object.keys(mine).length;
    body.append(el('p','quiz-progress','You: '+index+'/5 · Friend: '+Object.keys(theirs).length+'/5'));
    if(index>=QUICK_QUIZ_QUESTIONS.length){
      if(!isFinished(quiz)){
        body.append(el('p','quiz-hint','You finished! Waiting for your friend’s answers. ⏳'));
      }else{
        const myScore=quickQuizScore(quiz.answers,scope.uid),
          friendScore=quickQuizScore(quiz.answers,scope.friendUid);
        body.append(el('p','quiz-winner',myScore===friendScore
          ?"It's a draw! 🤝":myScore>friendScore?'You win! 🎉':'Friend wins!'));
        body.append(el('p','quiz-hint','You: '+myScore+'/5 · Friend: '+friendScore+'/5'));
      }
    }else{
      const q=QUICK_QUIZ_QUESTIONS[index];
      body.append(el('h3','quiz-question','Question '+(index+1)+'/5 · '+q.text));
      const choices=el('div','quiz-choices');
      for(let i=0;i<q.options.length;i++){
        const button=el('button','quiz-choice',q.options[i]);
        button.type='button';button.disabled=busy;
        button.onclick=()=>{void submitAnswer(index,i)};
        choices.append(button);
      }
      body.append(choices);
    }
    if(canRestart(quiz)){
      const replay=el('button','quiz-primary',isFinished(quiz)?'Play quiz again':'Restart inactive quiz');
      replay.type='button';replay.disabled=busy;replay.onclick=()=>{void startQuiz()};
      body.append(replay);
    }
  }
  async function runAction(perform){
    if(!current()||!confirmed||busy||!ref)return;
    busy=true;error='';render();
    const original=scope,reference=ref;
    try{
      await runTransaction(db,async tx=>{
        if(scope!==original||!current())throw Error('Conversation changed');
        const snap=await tx.get(reference);
        await perform(tx,snap,original,reference);
      });
      if(scope===original)error='';
    }catch(e){
      if(scope===original){
        error=e?.code==='permission-denied'
          ?'Quiz not saved. Publish the latest private Firestore game rules.'
          :'Could not save quiz: '+(e?.message||'Connection failed');
      }
    }finally{
      if(scope===original){busy=false;render()}
    }
  }
  function startQuiz(){
    return runAction(async(tx,snap,original,reference)=>{
      const existing=snap.exists()?snap.data():null;
      if(existing && !canRestart(existing))throw Error('Finish the current quiz first.');
      const next={answers:{},round:existing?(existing.round+1):0,updatedAt:serverTimestamp()};
      if(existing)tx.update(reference,next);
      else tx.set(reference,{...next,createdAt:serverTimestamp()});
    });
  }
  function submitAnswer(question,answer){
    if(!Number.isInteger(question)||question<0||question>=5 ||
       !Number.isInteger(answer)||answer<0||answer>3)return;
    return runAction(async(tx,snap,original,reference)=>{
      if(!snap.exists())throw Error('Start a quiz first.');
      const mine=snap.data().answers?.[original.uid]||{};
      if(Object.keys(mine).length!==question ||
         Object.prototype.hasOwnProperty.call(mine,String(question))){
        throw Error('This question was already answered.');
      }
      tx.update(reference,new FieldPath('answers',original.uid,String(question)),
        answer,'updatedAt',serverTimestamp());
    });
  }
  function open(){
    const ctx=getContext();
    if(!ctx?.threadId||!ctx.uid||!ctx.friendUid)return;
    close();
    scope={...ctx};opened=true;
    ref=doc(db,'threads',ctx.threadId,'quizzes','current');
    panel.classList.remove('hidden');
    launcher.setAttribute('aria-expanded','true');
    // Opening Quick Quiz closes the Tic-Tac-Toe popover, but does not stop its
    // real-time invitation listener or alter its Firestore document.
    gameClose.click();
    render();
    const original=scope;
    unsubscribe=onSnapshot(ref,{includeMetadataChanges:true},
      snapshot=>{
        if(scope!==original||!current())return;
        quiz=snapshot.exists()?snapshot.data():null;
        confirmed=!snapshot.metadata.fromCache;
        render();
      },
      e=>{
        if(scope!==original||!current())return;
        confirmed=false;
        error=e?.code==='permission-denied'
          ?'Quiz unavailable. Publish the latest private Firestore game rules.'
          :'Quiz connection failed: '+(e?.message||'Unknown error');
        render();
      });
  }
  launcher.onclick=()=>{if(opened)close();else open()};
  closeBtn.onclick=close;
  panel.addEventListener('keydown',event=>{if(event.key==='Escape')close()});
  return {open,close};
}
