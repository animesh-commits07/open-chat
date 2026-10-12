import {doc,onSnapshot,runTransaction,serverTimestamp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

// Private two-player Tic-Tac-Toe. No chat messages or other features are
// written here: one /threads/{threadId}/games/current Firestore document.
// Firestore rules independently verify every invite, accepted move and result.
const LINES=[
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];
const TERMINAL=new Set(['won','draw','declined','cancelled']);
const EMPTY=()=>Array(9).fill('');

export function winnerFor(board,mark){
  return LINES.some(([a,b,c])=>board[a]===mark && board[b]===mark && board[c]===mark);
}
export function gameMoveOutcome(board,mark){
  return winnerFor(board,mark)
    ?{state:'won',winner:mark}
    :board.every(Boolean)?{state:'draw',winner:''}
    :{state:'playing',winner:''};
}

export function createTicTacToeController({db,getContext}){
  const $=id=>document.getElementById(id);
  const button=$('gameToggleBtn'),panel=$('gamePanel'),status=$('gameStatus');
  const boardUI=$('gameBoard'),primary=$('gamePrimaryBtn'),secondary=$('gameSecondaryBtn');
  const errorUI=$('gameError'),closeButton=$('gameCloseBtn');
  let scope=null,reference=null,unsubscribe=null,game=null,serverReady=false;
  let isBusy=false,panelOpen=false,errorMessage='',notifiedInvite=null;

  const cells=Array.from({length:9},(_,index)=>{
    const cell=document.createElement('button');
    cell.type='button';cell.className='game-cell';cell.dataset.index=String(index);
    cell.setAttribute('aria-label','Row '+(Math.floor(index/3)+1)+
      ', column '+(index%3+1)+': empty');
    cell.onclick=()=>{void makeMove(index)};
    boardUI.append(cell);
    return cell;
  });
  function stillCurrent(){
    const now=getContext();
    return !!scope && !!now && now.threadId===scope.threadId &&
      now.uid===scope.uid && now.friendUid===scope.friendUid;
  }
  function showError(error){
    errorMessage=error?.code==='permission-denied'
      ?'Mini Games cannot save yet. Publish the updated Firestore security rules.'
      :'Game could not be updated: '+(error?.message||'Connection failed');
    render();
  }
  function setAction(element,label,callback){
    element.classList.toggle('hidden',!label);
    element.textContent=label||'';
    element.disabled=isBusy || !serverReady || !stillCurrent();
    element.onclick=callback?()=>{void callback()}:null;
  }
  function setOpen(value){
    panelOpen=!!value && !!scope;
    panel.classList.toggle('hidden',!panelOpen);
    button.setAttribute('aria-expanded',String(panelOpen));
    button.setAttribute('aria-pressed',String(panelOpen));
  }
  function render(){
    const activeScope=stillCurrent();
    button.disabled=!activeScope;
    const inviteForMe=activeScope && game?.state==='invited' &&
      game.oUid===scope.uid;
    button.textContent=inviteForMe?'🎮 •':'🎮';
    button.title=inviteForMe?'New Tic-Tac-Toe invitation':'Play Tic-Tac-Toe';
    button.setAttribute('aria-label',button.title);

    errorUI.textContent=errorMessage;
    errorUI.classList.toggle('hidden',!errorMessage);
    let text='Invite a friend to play Tic-Tac-Toe!';
    let board=EMPTY(),canPlay=false;
    let main='',second='',onMain=null,onSecond=null;
    if(!activeScope){text='Open a private chat to play.'}
    else if(!serverReady){text=errorMessage?'Game unavailable':'Connecting to private game…'}
    else if(!game){
      main='Invite friend';onMain=inviteGame;
    }else{
      board=Array.isArray(game.board)&&game.board.length===9?game.board:EMPTY();
      const mine=game.xUid===scope.uid?'X':'O';
      const other=mine==='X'?'O':'X';
      const friend='@'+(scope.friendName||'friend');
      if(game.state==='invited'){
        if(game.xUid===scope.uid){
          text='Invitation sent to '+friend+'. Waiting for acceptance…';
          second='Cancel invite';onSecond=()=>respond('cancelled');
        }else if(game.oUid===scope.uid){
          text=friend+' invited you! You will play ⭕ and they will play ❌.';
          main='Accept game';onMain=()=>respond('playing');
          second='Decline';onSecond=()=>respond('declined');
        }else text='Waiting for invitation…';
      }else if(game.state==='playing'){
        const myTurn=game.turn===mine;
        text=myTurn?'Your turn ('+(mine==='X'?'❌':'⭕')+')':
          'Waiting for '+friend+' ('+(other==='X'?'❌':'⭕')+')…';
        canPlay=myTurn && !isBusy && !errorMessage;
        second='End game';onSecond=()=>respond('cancelled');
      }else{
        if(game.state==='won')
          text=game.winner===mine?'You won! 🏆':friend+' won this round.';
        else if(game.state==='draw')text='It’s a draw! 🤝';
        else if(game.state==='declined')text='Game invitation declined.';
        else if(game.state==='cancelled')text='Game ended.';
        else text='Game is ready for a rematch.';
        main='Play again';onMain=inviteGame;
      }
    }
    status.textContent=text;
    for(let i=0;i<cells.length;i++){
      const value=board[i],cell=cells[i];
      cell.textContent=value==='X'?'❌':value==='O'?'⭕':'';
      cell.disabled=!canPlay || !serverReady || value!=='' || !activeScope;
      cell.classList.toggle('is-playable',!cell.disabled);
      cell.setAttribute('aria-label','Row '+(Math.floor(i/3)+1)+
        ', column '+(i%3+1)+': '+(value==='X'?'X':value==='O'?'O':'empty'));
    }
    setAction(primary,main,onMain);
    setAction(secondary,second,onSecond);
  }

  function close(){
    if(unsubscribe){unsubscribe();unsubscribe=null}
    scope=null;reference=null;game=null;serverReady=false;
    isBusy=false;errorMessage='';notifiedInvite=null;
    setOpen(false);render();
  }
  function open(threadId,uid,friendUid,friendName='friend'){
    close();
    scope={threadId,uid,friendUid,friendName};
    reference=doc(db,'threads',threadId,'games','current');
    setOpen(false);render();
    const matchedScope=scope;
    unsubscribe=onSnapshot(
      reference,{includeMetadataChanges:true},
      snapshot=>{
        if(!stillCurrent()||scope!==matchedScope)return;
        game=snapshot.exists()?snapshot.data():null;
        serverReady=!snapshot.metadata.fromCache;
        if(serverReady && game?.state==='invited' && game.oUid===scope.uid){
          const created=game.createdAt?.toMillis?.();
          const key=String(created||'waiting');
          if(notifiedInvite!==key){notifiedInvite=key;setOpen(true)}
        }
        render();
      },
      error=>{
        if(!stillCurrent()||scope!==matchedScope)return;
        serverReady=false;showError(error);
      }
    );
  }
  async function runAction(operation){
    if(isBusy || !stillCurrent() || !serverReady || !reference)return;
    const original=scope,ref=reference;
    isBusy=true;errorMessage='';render();
    try{
      await runTransaction(db,async tx=>{
        const snap=await tx.get(ref);
        await operation(tx,snap,original);
      });
      if(scope===original && stillCurrent())errorMessage='';
    }catch(error){
      if(scope===original && stillCurrent())showError(error);
    }finally{
      if(scope===original){isBusy=false;render()}
    }
  }
  function inviteGame(){
    return runAction(async(tx,snap,current)=>{
      if(snap.exists() && !TERMINAL.has(snap.data().state))
        throw Error('Finish or end the current game first.');
      tx.set(reference,{
        xUid:current.uid,oUid:current.friendUid,board:EMPTY(),turn:'X',
        state:'invited',winner:'',
        createdAt:serverTimestamp(),updatedAt:serverTimestamp()
      });
    });
  }
  function respond(next){
    if(!['playing','declined','cancelled'].includes(next))return;
    return runAction(async(tx,snap,current)=>{
      if(!snap.exists())throw Error('Game invitation no longer exists.');
      const data=snap.data();
      if(next==='playing'||next==='declined'){
        if(data.state!=='invited'||data.oUid!==current.uid)
          throw Error('Only the invited player can respond.');
      }else if(!(
        (data.state==='invited'&&data.xUid===current.uid) ||
        (data.state==='playing'&&[data.xUid,data.oUid].includes(current.uid))
      ))throw Error('This game cannot be ended.');
      tx.update(reference,{state:next,updatedAt:serverTimestamp()});
    });
  }
  function makeMove(index){
    if(!Number.isInteger(index)||index<0||index>8)return;
    return runAction(async(tx,snap,current)=>{
      if(!snap.exists())throw Error('Game was removed.');
      const currentGame=snap.data(),mark=currentGame.turn;
      if(currentGame.state!=='playing'||
        !((mark==='X'&&currentGame.xUid===current.uid)||
          (mark==='O'&&currentGame.oUid===current.uid)))
        throw Error('Wait for your turn.');
      if(!Array.isArray(currentGame.board)||currentGame.board.length!==9||
        currentGame.board[index]!=='')throw Error('That square is unavailable.');
      const board=currentGame.board.slice();
      board[index]=mark;
      const result=gameMoveOutcome(board,mark);
      tx.update(reference,{
        board,turn:mark==='X'?'O':'X',state:result.state,
        winner:result.winner,updatedAt:serverTimestamp()
      });
    });
  }

  button.onclick=()=>{if(stillCurrent())setOpen(!panelOpen)};
  closeButton.onclick=()=>setOpen(false);
  render();
  return {open,close};
}
