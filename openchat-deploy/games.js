// OpenChat private mini-games. Isolated from the message, typing, reactions,
// presence, receipts and notification streams. No user input is parsed as HTML.
export const QUIZ_QUESTIONS=[
  {question:'Which planet is known as the Red Planet?',choices:['Venus','Mars','Jupiter','Saturn'],answer:1},
  {question:'How many sides does a hexagon have?',choices:['5','6','7','8'],answer:1},
  {question:'Which animal is the tallest on land?',choices:['Giraffe','Elephant','Zebra','Lion'],answer:0},
  {question:'What is the capital of Japan?',choices:['Seoul','Beijing','Bangkok','Tokyo'],answer:3},
  {question:'Which number comes next: 2, 4, 8, 16, …?',choices:['18','32','24','20'],answer:1}
];
export const TTT_LINES=[
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];
export function ticTacToeWinner(board,mark,moves){
  if(TTT_LINES.some(line=>line.every(i=>board[String(i)]===mark)))return mark;
  return moves===9?'draw':'';
}
export function blankTttBoard(){
  return Object.fromEntries(Array.from({length:9},(_,i)=>[String(i),'']));
}
export function quizComplete(answers,uid){
  const own=answers && typeof answers==='object'?answers[uid]:null;
  return !!own && typeof own==='object' && Object.keys(own).length===QUIZ_QUESTIONS.length;
}
export function quizScore(answers,uid){
  const own=answers && typeof answers==='object'?answers[uid]:null;
  if(!own || typeof own!=='object')return 0;
  return QUIZ_QUESTIONS.reduce((sum,q,i)=>sum+(own[String(i)]===q.answer?1:0),0);
}
export function createChatMiniGames({
  db,doc,FieldPath,onSnapshot,runTransaction,serverTimestamp,
  getUser,getChat,panel,launchButton
}){
  let current=null,unsubs=[],records={ttt:null,quiz:null};
  let confirmed={ttt:false,quiz:false},busy=false,errorMessage='';
  const GAME_TYPES=['ttt','quiz'];
  const ONE_HOUR=60*60*1000;
  const el=(tag,cls,text)=>{
    const n=document.createElement(tag);
    if(cls)n.className=cls;
    if(text!==undefined)n.textContent=text;
    return n;
  };
  const userActive=()=>!!current && !!getUser() && !!getChat() &&
    getUser().uid===current.uid && getChat().id===current.threadId;
  const participants=()=>[current.uid,current.peerUid].sort();
  const gameDoc=type=>doc(db,'threads',current.threadId,'games',type);
  const gameText=type=>type==='ttt'?'Tic-Tac-Toe':'Quick Quiz';
  const freshEnough=data=>{
    const time=data?.updatedAt?.toMillis?.()||0;
    return time>0 && Date.now()-time<ONE_HOUR;
  };
  const quizDone=data=>{
    const [a,b]=participants();
    return quizComplete(data?.answers,a)&&quizComplete(data?.answers,b);
  };
  function close(){
    for(const off of unsubs){try{off()}catch{}}
    unsubs=[];
    current=null;records={ttt:null,quiz:null};confirmed={ttt:false,quiz:false};
    busy=false;errorMessage='';
    panel.classList.add('hidden');
    panel.replaceChildren();
    launchButton.setAttribute('aria-expanded','false');
  }
  async function runAction(fn){
    if(!userActive()||busy)return;
    busy=true;errorMessage='';render();
    try{await fn()}
    catch(error){
      if(userActive()){
        errorMessage=error?.code==='permission-denied'
          ?'Game was not saved. Publish the latest Firestore game rules in Firebase Console.'
          :'Could not save game: '+(error?.message||'Unknown error');
      }
      console.warn('Mini game save failed:',error?.code||error?.message);
    }finally{busy=false;if(userActive())render()}
  }
  async function startGame(type){
    if(!GAME_TYPES.includes(type)||!confirmed[type]||!userActive())return;
    const threadId=current.threadId,uid=current.uid,members=participants(),ref=gameDoc(type);
    await runAction(()=>runTransaction(db,async tx=>{
      if(!userActive()||current.threadId!==threadId||current.uid!==uid)throw Error('Chat changed');
      const snap=await tx.get(ref),old=snap.exists()?snap.data():null;
      if(old){
        const complete=type==='ttt' ?old.winner!=='' :quizDone(old);
        if(!complete&&freshEnough(old))throw Error('Finish the current game first.');
      }
      const round=old?(old.round||0)+1:0,now=serverTimestamp();
      if(type==='ttt'){
        const next={
          cells:blankTttBoard(),moves:0,turn:members[round%2],
          winner:'',round,updatedAt:now
        };
        if(old)tx.update(ref,next);
        else tx.set(ref,{...next,createdAt:now});
      }else{
        const next={answers:{},round,updatedAt:now};
        if(old)tx.update(ref,next);
        else tx.set(ref,{...next,createdAt:now});
      }
    }));
  }
  async function playTttCell(index){
    if(!userActive()||!confirmed.ttt||!Number.isInteger(index)||index<0||index>8)return;
    const uid=current.uid,threadId=current.threadId,members=participants(),ref=gameDoc('ttt');
    await runAction(()=>runTransaction(db,async tx=>{
      if(!userActive()||current.threadId!==threadId||current.uid!==uid)throw Error('Chat changed');
      const snap=await tx.get(ref);
      if(!snap.exists())throw Error('Start a game first');
      const game=snap.data();
      if(game.winner!==''||game.turn!==uid)throw Error('Wait for your turn.');
      if(game.cells[String(index)]!=='')throw Error('Choose an empty square.');
      const mark=uid===members[0]?'X':'O';
      const cells={...game.cells,[String(index)]:mark};
      const moves=game.moves+1;
      const winner=ticTacToeWinner(cells,mark,moves);
      const turn=winner?'':members.find(id=>id!==uid);
      tx.update(ref,{cells,moves,winner,turn,updatedAt:serverTimestamp()});
    }));
  }
  async function answerQuiz(index,choice){
    if(!userActive()||!confirmed.quiz || !Number.isInteger(index) ||
       !Number.isInteger(choice)||index<0||index>=QUIZ_QUESTIONS.length ||
       choice<0||choice>3)return;
    const uid=current.uid,threadId=current.threadId,ref=gameDoc('quiz');
    await runAction(()=>runTransaction(db,async tx=>{
      if(!userActive()||current.threadId!==threadId||current.uid!==uid)throw Error('Chat changed');
      const snap=await tx.get(ref);
      if(!snap.exists())throw Error('Start a quiz first');
      const answers=snap.data().answers||{}, mine=answers[uid]||{};
      if(Object.keys(mine).length!==index || Object.prototype.hasOwnProperty.call(mine,String(index))){
        throw Error('This question is already answered.');
      }
      tx.update(ref,new FieldPath('answers',uid,String(index)),choice,
        'updatedAt',serverTimestamp());
    }));
  }
  function render(){
    if(!userActive())return;
    panel.replaceChildren();
    const surface=el('section','mini-games-surface');
    surface.setAttribute('role','dialog');
    surface.setAttribute('aria-modal','true');
    surface.setAttribute('aria-label','Chat mini games');
    const heading=el('div','mini-games-heading');
    const title=el('h2',null,'🎮 Chat Mini Games');
    const closeButton=el('button','mini-games-close','×');
    closeButton.type='button';closeButton.title='Close games';
    closeButton.setAttribute('aria-label','Close games');
    closeButton.onclick=close;
    heading.append(title,closeButton);surface.append(heading);
    surface.append(el('p','mini-games-subtitle','Play together in this private chat. Moves sync between devices.'));
    const tabs=el('div','mini-games-tabs');
    tabs.setAttribute('role','tablist');
    for(const type of GAME_TYPES){
      const button=el('button','mini-game-tab'+(current.type===type?' selected':''),type==='ttt'?'❌⭕ Tic-Tac-Toe':'🧠 Quick Quiz');
      button.type='button';button.setAttribute('role','tab');
      button.setAttribute('aria-selected',String(current.type===type));
      button.onclick=()=>{current.type=type;errorMessage='';render()};
      tabs.append(button);
    }
    surface.append(tabs);
    if(errorMessage){const error=el('div','mini-games-error',errorMessage);error.setAttribute('role','alert');surface.append(error)}
    const content=el('div','mini-games-content');
    if(!confirmed[current.type]){
      content.append(el('p','mini-games-hint','Syncing private game…'));
    }else if(!records[current.type]){
      const button=el('button','mini-games-primary','Start '+gameText(current.type));
      button.type='button';button.disabled=busy;
      button.onclick=()=>{void startGame(current.type)};
      content.append(el('p','mini-games-hint',current.type==='ttt'
        ?'Take turns placing X or O. First to get three in a row wins.'
        :'Both players answer five fun questions. Highest score wins.'));
      content.append(button);
    }else if(current.type==='ttt'){
      renderTtt(content,records.ttt);
    }else{
      renderQuiz(content,records.quiz);
    }
    surface.append(content);
    panel.append(surface);
  }
  function renderTtt(root,game){
    const members=participants(),mark=current.uid===members[0]?'X':'O';
    const myTurn=game.winner===''&&game.turn===current.uid;
    let summary=game.winner==='draw'?"It's a draw! 🤝"
      :game.winner?game.winner===mark?'You won! 🎉':'Friend won this round!'
      :myTurn?'Your turn ('+mark+')':'Friend’s turn ('+(mark==='X'?'O':'X')+')';
    root.append(el('p','mini-game-state',summary));
    const board=el('div','mini-ttt-board');
    board.setAttribute('role','group');board.setAttribute('aria-label','Tic-Tac-Toe board');
    for(let i=0;i<9;i++){
      const value=game.cells?.[String(i)]||'';
      const cell=el('button','mini-ttt-cell'+(value?' occupied':'')+(value==='X'?' x':' o'),value||'');
      cell.type='button';
      cell.setAttribute('aria-label','Row '+(Math.floor(i/3)+1)+', column '+(i%3+1)+': '+(value||'empty'));
      cell.disabled=busy||!myTurn||!!value;
      cell.onclick=()=>{void playTttCell(i)};
      board.append(cell);
    }
    root.append(board);
    root.append(el('p','mini-games-hint','You are '+mark+'. The match is shared with @'+(current.peerName||'friend')+'.'));
    if(game.winner!==''||!freshEnough(game)){
      const restart=el('button','mini-games-primary','Play again');
      restart.type='button';restart.disabled=busy;
      restart.onclick=()=>{void startGame('ttt')};
      root.append(restart);
    }
  }
  function renderQuiz(root,game){
    const answers=game.answers||{},mine=answers[current.uid]||{};
    const theirs=answers[current.peerUid]||{};
    const index=Object.keys(mine).length,friendCount=Object.keys(theirs).length;
    root.append(el('p','mini-game-state','You: '+index+'/5 answered · Friend: '+friendCount+'/5 answered'));
    if(index>=QUIZ_QUESTIONS.length){
      if(!quizDone(game)){
        root.append(el('p','mini-games-hint','You finished! Waiting for your friend to answer. ⏳'));
      }else{
        const myScore=quizScore(answers,current.uid),theirScore=quizScore(answers,current.peerUid);
        const verdict=myScore===theirScore?"It's a draw!":myScore>theirScore?'You win! 🎉':'Friend wins!';
        root.append(el('p','mini-quiz-result',verdict));
        root.append(el('p','mini-games-hint','Your score: '+myScore+'/5 · Friend: '+theirScore+'/5'));
        const replay=el('button','mini-games-primary','Play quiz again');
        replay.type='button';replay.disabled=busy;
        replay.onclick=()=>{void startGame('quiz')};root.append(replay);
      }
    }else{
      const q=QUIZ_QUESTIONS[index];
      root.append(el('h3','mini-quiz-question','Question '+(index+1)+'/5 · '+q.question));
      const choices=el('div','mini-quiz-choices');
      q.choices.forEach((choice,i)=>{
        const button=el('button','mini-quiz-choice',choice);
        button.type='button';button.disabled=busy;
        button.onclick=()=>{void answerQuiz(index,i)};
        choices.append(button);
      });
      root.append(choices);
    }
    if(!freshEnough(game)&&!quizDone(game)){
      const restart=el('button','mini-games-secondary','Restart inactive quiz');
      restart.type='button';restart.disabled=busy;
      restart.onclick=()=>{void startGame('quiz')};
      root.append(restart);
    }
  }
  function open(){
    const chat=getChat(),user=getUser();
    if(!chat||!user||!chat.other?.uid)return;
    close();
    current={
      threadId:chat.id,uid:user.uid,peerUid:chat.other.uid,
      peerName:chat.other.username||'friend',type:'ttt'
    };
    panel.classList.remove('hidden');
    launchButton.setAttribute('aria-expanded','true');
    render();
    for(const type of GAME_TYPES){
      const threadId=current.threadId,uid=current.uid;
      const unsubscribe=onSnapshot(gameDoc(type),{includeMetadataChanges:true},
        snapshot=>{
          if(!userActive()||current.threadId!==threadId||current.uid!==uid)return;
          records[type]=snapshot.exists()?snapshot.data():null;
          confirmed[type]=!snapshot.metadata.fromCache;
          render();
        },
        error=>{
          if(!userActive()||current.threadId!==threadId||current.uid!==uid)return;
          confirmed[type]=false;
          errorMessage=error?.code==='permission-denied'
            ?'Games unavailable. Publish the latest private Firestore game rules.'
            :'Game sync failed: '+(error?.message||'Unknown error');
          render();
        });
      unsubs.push(unsubscribe);
    }
  }
  panel.addEventListener('click',event=>{if(event.target===panel)close()});
  launchButton.onclick=()=>{if(current)close();else open()};
  return {open,close};
}
