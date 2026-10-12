import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,signInWithRedirect,getRedirectResult,onAuthStateChanged,signOut,setPersistence,browserLocalPersistence} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {getFirestore,doc,FieldPath,deleteField,setDoc,updateDoc,getDoc,getDocFromServer,collection,query,where,getDocs,limit,onSnapshot,addDoc,deleteDoc,serverTimestamp,orderBy,documentId,startAt,startAfter,endAt,runTransaction} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import {firebaseConfig} from './firebase-config.js';
import {createTicTacToeController} from './tic-tac-toe.js?v=fast-game-20261012';
import {createQuickQuizController} from './quick-quiz.js?v=fast-game-20261012';
import {createLiveDoodleController} from './live-doodle.js?v=doodle-screen-20261012';
import {createAnimatedMessagesController} from './animated-messages.js?v=animated-messages-20261012';
import {createMessageEffectsController} from './message-effects.js?v=click-play-20261012';
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app),provider=new GoogleAuthProvider();
// Store Firebase's own auth session across tab closes, Back navigation and browser relaunch.
// Never save Firebase credentials or ID tokens manually in localStorage.
const persistenceReady=setPersistence(auth,browserLocalPersistence).then(()=>true).catch(error=>{
  console.warn('Persistent authentication storage is unavailable:',error);
  return false;
});
const $=id=>document.getElementById(id);let me=null,active=null,stopMessages=null,stopThreads=null,users=new Map(),threads=[];let view='people',directoryCursor=null,directoryTerm='',directoryLoading=false,directoryFinished=false,directoryCount=0,peopleVersion=0,threadVersion=0;
// One-time visual message effects are chosen in the existing composer.
// No effect is sent by default; old messages remain compatible.
const animatedMessages=createAnimatedMessagesController();
// The existing composer still stores an optional effect choice on each
// message. Actual playback waits until a user taps that message's Animate
// control, then both friends receive the same private Firestore signal.
const messageEffects=createMessageEffectsController({db,
  getContext:()=>me&&active?{threadId:active.id,uid:me.uid}:null,
  onStatus:message=>status(message)
});
// Tic-Tac-Toe is isolated from messaging, push, reactions and typing.
// The controller is active only for the current two-person conversation.
const ticTacToe=createTicTacToeController({db,getContext:()=>
  me && active?{threadId:active.id,uid:me.uid,friendUid:active.other.uid}:null
});
// Quick Quiz is separate from the existing Tic-Tac-Toe invitation state.
const quickQuiz=createQuickQuizController({db,getContext:()=>
  me && active?{threadId:active.id,uid:me.uid,friendUid:active.other.uid}:null
});
$('gameToggleBtn').addEventListener('click',()=>quickQuiz.close());
// Live Doodle uses a separate private Firestore session and closes competing
// mini-game overlays without changing their saved data.
const liveDoodle=createLiveDoodleController({db,getContext:()=>
  me && active?{threadId:active.id,uid:me.uid,friendUid:active.other.uid,
    friendName:active.other.username}:null
});
$('gameToggleBtn').addEventListener('click',()=>liveDoodle.exit());
$('quizLaunchBtn').addEventListener('click',()=>liveDoodle.exit());
$('doodleLaunchBtn').addEventListener('click',()=>quickQuiz.close());

// One-device-one-account Firebase push subscriptions; the server selects the receiver.
const PUSH_WORKER='https://delicate-dawn-9e2e.animeshgupta627.workers.dev';
const VAPID_PUBLIC_KEY='BOxyo7vxirvYAzJRedbprbSMgoVCYD389WzJ6RAFXtjOzVj0gPJL1NZu8UwZRMC5MKAcszcN4IdcvFV4cZEnR3s';
const PUSH_OPT_IN_KEY='openchat_private_push_opt_in';
const PUSH_REMINDER_KEY_PREFIX='openchat_push_reminder_after_';
const PUSH_REMINDER_SNOOZE_MS=7*24*60*60*1000;
let pushBusy=false;
function pushSupported(){return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext}
function publicVapidBytes(str){
  const pad='='.repeat((4-str.length%4)%4);
  return Uint8Array.from(atob((str+pad).replace(/-/g,'+').replace(/_/g,'/')),x=>x.charCodeAt(0));
}
function pushStatus(message=''){$('notifyStatus').textContent=message}
function reminderKey(user){return PUSH_REMINDER_KEY_PREFIX+user.uid}
function refreshNotificationReminder(){
  const prompt=$('notificationPrompt');
  if(!me || $('appShell').classList.contains('hidden')){prompt.classList.add('hidden');return}
  const permission=('Notification' in window)?Notification.permission:'unsupported';
  const enabled=pushSupported() && permission==='granted' && localStorage.getItem(PUSH_OPT_IN_KEY)==='yes';
  if(enabled || Date.now()<Number(localStorage.getItem(reminderKey(me))||0)){
    prompt.classList.add('hidden');return;
  }
  const title=$('notificationPromptTitle'), message=$('notificationPromptText'), action=$('notificationPromptEnable');
  title.textContent='Stay updated with private messages';
  if(!pushSupported()){
    message.textContent='On iPhone, add OpenChat to your Home Screen using Safari to enable web push. Other browsers need notification support and HTTPS.';
    action.textContent='Got it';
  }else if(permission==='denied'){
    message.textContent='Notifications are blocked. Allow them for OpenChat in your phone or browser site settings, then come back.';
    action.textContent='How to allow';
  }else if(permission==='granted'){
    message.textContent='Your browser allows notifications. Turn on private message alerts for this Google account and device.';
    action.textContent='Turn on alerts';
  }else{
    message.textContent='Get a notification when someone sends you a private message. Your own sent messages will not notify you.';
    action.textContent='Enable notifications';
  }
  prompt.classList.remove('hidden');
}
$('notificationPromptDismiss').onclick=()=>{
  if(me)localStorage.setItem(reminderKey(me),String(Date.now()+PUSH_REMINDER_SNOOZE_MS));
  $('notificationPrompt').classList.add('hidden');
};
$('notificationPromptEnable').onclick=()=>{
  if(!me)return;
  if(!pushSupported()){
    $('notificationPromptText').textContent='To use notifications on iPhone: open OpenChat in Safari, tap Share → Add to Home Screen, open that icon, and allow notifications there.';
    return;
  }
  if(Notification.permission==='denied'){
    $('notificationPromptText').textContent='Open your browser site settings for OpenChat, change Notifications to Allow, and return to the app.';
    return;
  }
  $('notifyBtn').click();
};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshNotificationReminder()});
function updatePushButton(){
  const yes=localStorage.getItem(PUSH_OPT_IN_KEY)==='yes' && ('Notification' in window)&&Notification.permission==='granted';
  $('notifyBtn').textContent=yes?'🔔 Notifications on — turn off':'🔔 Enable notifications';
  $('notifyBtn').setAttribute('aria-pressed',String(yes));
  refreshNotificationReminder();
}
async function pushRequest(route,data,user){
  const token=await user.getIdToken();
  const response=await fetch(PUSH_WORKER+route,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify(data)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok || !result.ok)throw Error(result.error||'Notification server unavailable');
  return result;
}
async function registerPrivatePush(user){
  if(!pushSupported())throw Error('This browser needs HTTPS and push support. On iPhone, install OpenChat to Home Screen using Safari.');
  if(Notification.permission!=='granted')throw Error('Allow notifications in browser settings first.');
  const reg=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});
  let sub=await reg.pushManager.getSubscription();
  if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:publicVapidBytes(VAPID_PUBLIC_KEY)});
  await pushRequest('/subscribe',{subscription:sub.toJSON()},user);
  localStorage.setItem(PUSH_OPT_IN_KEY,'yes');
  updatePushButton();
}
async function unregisterPrivatePush(user){
  let sub=null;
  try{if('serviceWorker' in navigator){const reg=await navigator.serviceWorker.getRegistration('/sw.js');sub=await reg?.pushManager?.getSubscription()}}catch(e){}
  if(sub){
    try{await pushRequest('/unsubscribe',{endpoint:sub.endpoint},user)}catch(e){console.warn('Could not unregister push on server:',e)}
    try{await sub.unsubscribe()}catch(e){}
  }
  localStorage.removeItem(PUSH_OPT_IN_KEY);updatePushButton();pushStatus('Notifications off.');
}
async function signOutWithPushCleanup(){
  if(me&&localStorage.getItem(PUSH_OPT_IN_KEY)==='yes')await unregisterPrivatePush(me);
  await signOut(auth);
}
$('notifyBtn').onclick=async()=>{
  if(pushBusy||!me)return;
  pushBusy=true;$('notifyBtn').disabled=true;
  try{
    if(localStorage.getItem(PUSH_OPT_IN_KEY)==='yes') await unregisterPrivatePush(me);
    else{
      if(!pushSupported())throw Error('Push unsupported. On iPhone add the site to Home Screen from Safari.');
      let permission=Notification.permission;
      if(permission==='default')permission=await Notification.requestPermission();
      if(permission!=='granted')throw Error('Notifications blocked. Enable them in browser settings.');
      await registerPrivatePush(me);pushStatus('Only messages sent to you will notify this device.');
    }
  }catch(e){pushStatus(e.message||'Could not enable notifications');console.warn(e)}
  finally{pushBusy=false;$('notifyBtn').disabled=false;updatePushButton()}
};
async function resumePushIfEnabled(user){
  if(localStorage.getItem(PUSH_OPT_IN_KEY)!=='yes')return;
  if(!pushSupported()||Notification.permission!=='granted'){
    localStorage.removeItem(PUSH_OPT_IN_KEY);pushStatus('Notifications disabled by this browser.');updatePushButton();return;
  }
  try{await registerPrivatePush(user);pushStatus('Notifications enabled for received messages.');}
  catch(e){pushStatus('Could not restore notifications: '+e.message)}
}
async function notifyRecipient(threadId,messageId,user){
  try{await pushRequest('/notify',{threadId,messageId},user)}catch(e){console.warn('Message sent, notification may be delayed:',e)}
}
async function openNotificationChat(){
  const id=new URLSearchParams(location.search).get('chat');
  if(!id || !/^[A-Za-z0-9_-]{15,160}$/.test(id) || !me)return;
  try{
    const ownId=me.uid;
    const snap=await getDoc(doc(db,'threads',id));
    if(!snap.exists() || !me || me.uid!==ownId)return;
    const other=snap.data().members?.find(uid=>uid!==ownId);
    if(!other)return;
    const profile=await getUser(other);
    if(me?.uid===ownId)openChat(id,profile);
    history.replaceState(null,'',location.pathname);
  }catch(e){console.warn('Cannot open notification chat:',e)}
}
const validUsername=u=>typeof u==='string'&&/^[a-z][a-z0-9_]{2,19}$/.test(u);let myUsername='',authVersion=0,searchVersion=0;const normalize=u=>String(u||'').trim().replace(/^@/,'').toLowerCase();
const status=t=>$('status').textContent=t;const feedback=t=>$('authFeedback').textContent=t;
function clean(s){return String(s||'').trim()};function initials(s){return clean(s).slice(0,1).toUpperCase()||'?'};
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function pair(a,b){return [a,b].sort().join('_')}
$('googleLogin').onclick=async()=>{
  feedback('Opening Google sign-in…');
  // Open Google's popup directly from the click; Firebase waits for pending persistence changes.
  // Awaiting IndexedDB/storage first can cause mobile browsers to block the popup.
  try{await signInWithPopup(auth,provider)}
  catch(e){
    if(e.code==='auth/popup-blocked'){
      try{await signInWithRedirect(auth,provider);return}
      catch(x){feedback(x.message);return}
    }
    feedback(e.message);
  }
};
void persistenceReady.then(()=>getRedirectResult(auth)).catch(e=>feedback(e.message));
$('logoutBtn').onclick=signOutWithPushCleanup;
async function enterApp(){
  $('sessionLoading').classList.add('hidden');
  $('sideName').textContent='@'+myUsername;
  $('sideHandle').textContent='Your private username';
  $('sideAvatar').textContent=initials(myUsername);
  $('searchInput').value='';
  $('authPage').classList.add('hidden');$('usernamePage').classList.add('hidden');$('appShell').classList.remove('hidden');
  view='people';showPeople('');watchThreads();updatePushButton();
  startOwnPresence();
  void resumePushIfEnabled(me);void openNotificationChat();
}
$('usernameLogout').onclick=signOutWithPushCleanup;
$('usernameField').oninput=()=>{$('usernameField').value=normalize($('usernameField').value);$('usernameFeedback').textContent=''};
onAuthStateChanged(auth,async u=>{
  const version=++authVersion;
  await persistenceReady;
  if(version!==authVersion)return;
  if(stopMessages){stopMessages();stopMessages=null}
  if(stopThreads){stopThreads();stopThreads=null}
  ticTacToe.close();
  quickQuiz.close();
  liveDoodle.close();
  animatedMessages.endChat();
  messageEffects.close();
  stopOwnPresence();
  stopFriendPresence();
  stopEditing(false);
  closeTypingSession();
  clearReceiptWatchers();
  clearReply();closeActions();
  ++searchVersion;++peopleVersion;++threadVersion;users.clear();active=null;threads=[];me=u;myUsername='';view='people';directoryLoading=false;
  $('notificationPrompt').classList.add('hidden');
  $('sessionLoading').classList.remove('hidden');
  $('appShell').classList.add('hidden');$('appShell').classList.remove('chat-open');
  $('chatView').classList.add('hidden');$('chatWelcome').classList.remove('hidden');
  if(!u){$('usernamePage').classList.add('hidden');$('sessionLoading').classList.add('hidden');$('authPage').classList.remove('hidden');return}
  $('authPage').classList.add('hidden');$('usernamePage').classList.add('hidden');
  $('usernameForm').classList.add('hidden');$('usernameFeedback').textContent='Checking your account…';
  try{
    const profile=await getDoc(doc(db,'users',u.uid));if(version!==authVersion)return;
    const username=profile.exists()?profile.data().username:null;
    if(validUsername(username)){myUsername=username;users.set(u.uid,{uid:u.uid,username});enterApp();return}
    $('sessionLoading').classList.add('hidden');$('usernamePage').classList.remove('hidden');
    $('usernameForm').classList.remove('hidden');$('usernameFeedback').textContent='';
    const suggestion=normalize((u.email||'').split('@')[0]).replace(/[^a-z0-9_]/g,'').slice(0,20);
    $('usernameField').value=validUsername(suggestion)?suggestion:'';$('usernameField').focus();
  }catch(e){if(version===authVersion){$('sessionLoading').classList.add('hidden');$('usernamePage').classList.remove('hidden');$('usernameFeedback').textContent='Could not load account: '+e.message}}
},error=>{
  $('sessionLoading').classList.add('hidden');
  $('authPage').classList.remove('hidden');
  feedback('Could not restore your Google session: '+error.message);
});
$('usernameForm').onsubmit=async e=>{
  e.preventDefault();if(!me)return;const uid=me.uid,handle=normalize($('usernameField').value);
  $('usernameField').value=handle;
  if(!validUsername(handle)){$('usernameFeedback').textContent='Use 3–20 characters, starting with a letter (a–z, 0–9, _).';return}
  const button=$('saveUsername');button.disabled=true;$('usernameFeedback').textContent='Checking username…';
  try{
    await runTransaction(db,async tx=>{
      const handleRef=doc(db,'handles',handle),userRef=doc(db,'users',uid);
      const [reserved,existing]=await Promise.all([tx.get(handleRef),tx.get(userRef)]);
      if(reserved.exists())throw Error('That username is taken. Please choose another.');
      if(existing.exists()&&existing.data().username)throw Error('Account already has a username. Please reload.');
      tx.set(handleRef,{uid});
      tx.set(userRef,{username:handle,createdAt:existing.exists()&&existing.data().createdAt?existing.data().createdAt:serverTimestamp()});
    });
    if(!me||me.uid!==uid)return;
    myUsername=handle;users.set(uid,{uid,username:handle});$('usernameFeedback').textContent='';enterApp();
  }catch(err){$('usernameFeedback').textContent='Could not save username: '+err.message}
  finally{button.disabled=false}
};
function setView(next){
  view=next;
  $('peopleTab').classList.toggle('active',next==='people');
  $('chatsTab').classList.toggle('active',next==='chats');
  $('peopleTab').setAttribute('aria-pressed',String(next==='people'));
  $('chatsTab').setAttribute('aria-pressed',String(next==='chats'));
  $('allChatsBtn').classList.add('hidden');
}

const receiptWatchers=new Map();
const receiptQueue=[],receiptPending=new Map();
let receiptWorkers=0,visibleChatDocuments=[];
function outgoingReceiptState(message,pending=false){
  return message.seenAt?'seen':message.deliveredAt?'delivered':pending?'sending':'sent';
}
function receiptKey(threadId,messageId){return threadId+'/'+messageId}
function isChatActuallyVisible(threadId){
  return !!me && active?.id===threadId &&
    !document.hidden && (navigator.maxTouchPoints>0 || document.hasFocus()) &&
    !$('chatView').classList.contains('hidden') &&
    (window.innerWidth>700 || $('appShell').classList.contains('chat-open'));
}
function requestReceipt(threadId,messageId,recipientUid,seen=false){
  if(me?.uid!==recipientUid)return;
  const key=receiptKey(threadId,messageId);
  const existing=receiptPending.get(key);
  if(existing){if(seen)existing.seen=true;return}
  const task={key,threadId,messageId,recipientUid,seen};
  receiptPending.set(key,task);receiptQueue.push(task);
  processReceiptQueue();
}
function processReceiptQueue(){
  while(receiptWorkers<4 && receiptQueue.length){
    const task=receiptQueue.shift();receiptWorkers++;
    void commitReceipt(task).finally(()=>{
      receiptWorkers--;receiptPending.delete(task.key);
      processReceiptQueue();
    });
  }
}
async function commitReceipt(task){
  if(me?.uid!==task.recipientUid)return;
  try{
    await runTransaction(db,async transaction=>{
      if(me?.uid!==task.recipientUid)return;
      const ref=doc(db,'threads',task.threadId,'messages',task.messageId);
      const snap=await transaction.get(ref);
      if(!snap.exists())return;
      const message=snap.data();
      if(message.senderId===task.recipientUid)return;
      const updates={};
      if(!message.deliveredAt)updates.deliveredAt=serverTimestamp();
      if(task.seen && isChatActuallyVisible(task.threadId) && !message.seenAt){
        updates.seenAt=serverTimestamp();
      }
      if(Object.keys(updates).length)transaction.update(ref,updates);
    });
  }catch(error){
    // A receiver can be offline or a receipt may race another device.
    // Delivery/read status is never fabricated if the write fails.
    console.warn('Could not update message receipt:',error);
  }
}
function clearReceiptWatchers(){
  for(const unsubscribe of receiptWatchers.values())unsubscribe();
  receiptWatchers.clear();
  receiptQueue.length=0;receiptPending.clear();
  visibleChatDocuments=[];
}
function syncReceiptWatchers(list){
  if(!me)return;
  const ownUid=me.uid,activeIds=new Set(list.map(t=>t.id));
  for(const [id,unsubscribe] of receiptWatchers){
    if(!activeIds.has(id)){unsubscribe();receiptWatchers.delete(id)}
  }
  for(const thread of list){
    if(!thread?.members?.includes(ownUid)||receiptWatchers.has(thread.id))continue;
    const messages=query(collection(db,'threads',thread.id,'messages'),orderBy('createdAt','desc'),limit(80));
    const unsubscribe=onSnapshot(messages,{includeMetadataChanges:true},snapshot=>{
      if(me?.uid!==ownUid || snapshot.metadata.fromCache)return;
      for(const item of snapshot.docs){
        const message=item.data();
        if(message.senderId!==ownUid && !message.deliveredAt){
          requestReceipt(thread.id,item.id,ownUid,false);
        }
      }
    },error=>console.warn('Could not sync deliveries:',error));
    receiptWatchers.set(thread.id,unsubscribe);
  }
}
function markVisibleChatSeen(){
  if(!active || !isChatActuallyVisible(active.id)||!me)return;
  for(const item of visibleChatDocuments){
    const message=item.data();
    if(message.senderId!==me.uid && !message.seenAt && !item.metadata?.hasPendingWrites){
      requestReceipt(active.id,item.id,me.uid,true);
    }
  }
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)markVisibleChatSeen()});
window.addEventListener('focus',markVisibleChatSeen);
window.addEventListener('pageshow',markVisibleChatSeen);

// Private Online / Last Seen: a server-timestamp heartbeat is refreshed only
// while a signed-in member has the site visible. Never broadcast private text.
// No online:false writes on tab close: a second logged-in tab/device can still
// be active. Remote clients expire the heartbeat automatically after 105s.
const PRESENCE_HEARTBEAT_MS=45000;
const PRESENCE_ONLINE_MS=105000;
const PRESENCE_RENDER_MS=15000;
const PRESENCE_PERMISSION_RETRY_MS=180000;
let ownPresenceUid=null,ownPresenceTimer=null,ownPresenceRetryAfter=0,ownPresenceLastAttempt=0;
let ownPresencePermissionError=false;
const presenceWritesInProgress=new Set();
let stopPeerPresence=null,peerPresenceRefreshTimer=null;
let peerPresence={lastActiveMs:0,loaded:false,error:''};

function stopOwnPresence(){
  if(ownPresenceTimer!==null)clearInterval(ownPresenceTimer);
  ownPresenceTimer=null;
  ownPresenceUid=null;
  ownPresenceRetryAfter=0;
  ownPresenceLastAttempt=0;
  ownPresencePermissionError=false;
}
async function writeOwnPresence(uid){
  if(!me || me.uid!==uid || ownPresenceUid!==uid || document.hidden ||
     presenceWritesInProgress.has(uid) || Date.now()<ownPresenceRetryAfter ||
     Date.now()-ownPresenceLastAttempt<10000)return;
  ownPresenceLastAttempt=Date.now();
  presenceWritesInProgress.add(uid);
  try{
    await setDoc(doc(db,'presence',uid),{lastActiveAt:serverTimestamp()});
    if(ownPresenceUid===uid && me?.uid===uid){
      ownPresencePermissionError=false;
      ownPresenceRetryAfter=0;
      if(active)renderTypingPresence();
    }
  }catch(error){
    console.warn('Online presence write unavailable:',error?.code||error?.message);
    if(ownPresenceUid===uid && me?.uid===uid){
      ownPresencePermissionError=error?.code==='permission-denied';
      // Avoid continuous denied writes while Firebase console rules are old.
      ownPresenceRetryAfter=Date.now()+PRESENCE_PERMISSION_RETRY_MS;
      if(active)renderTypingPresence();
    }
  }finally{
    presenceWritesInProgress.delete(uid);
  }
}
function startOwnPresence(){
  stopOwnPresence();
  if(!me || !myUsername)return;
  ownPresenceUid=me.uid;
  const uid=me.uid;
  if(!document.hidden)void writeOwnPresence(uid);
  ownPresenceTimer=setInterval(()=>{
    if(ownPresenceUid===uid && !document.hidden)void writeOwnPresence(uid);
  },PRESENCE_HEARTBEAT_MS);
}
function resumeOwnPresence(){
  if(ownPresenceUid && !document.hidden)void writeOwnPresence(ownPresenceUid);
}
document.addEventListener('visibilitychange',resumeOwnPresence);
window.addEventListener('pageshow',resumeOwnPresence);
window.addEventListener('focus',resumeOwnPresence);

function stopFriendPresence(){
  if(stopPeerPresence){stopPeerPresence();stopPeerPresence=null}
  if(peerPresenceRefreshTimer!==null)clearInterval(peerPresenceRefreshTimer);
  peerPresenceRefreshTimer=null;
  peerPresence={lastActiveMs:0,loaded:false,error:''};
}
function watchFriendPresence(threadId,friendUid){
  stopFriendPresence();
  peerPresenceRefreshTimer=setInterval(()=>{
    if(active?.id!==threadId || active?.other?.uid!==friendUid){
      stopFriendPresence();return;
    }
    renderTypingPresence();
  },PRESENCE_RENDER_MS);
  stopPeerPresence=onSnapshot(
    doc(db,'presence',friendUid),
    {includeMetadataChanges:true},
    snapshot=>{
      if(!me || active?.id!==threadId || active?.other?.uid!==friendUid)return;
      // Don't claim somebody is online from an unverified local cache.
      if(snapshot.metadata.fromCache)return;
      peerPresence={
        lastActiveMs:snapshot.data()?.lastActiveAt?.toMillis?.()||0,
        loaded:true,error:''
      };
      renderTypingPresence();
    },
    error=>{
      if(!me || active?.id!==threadId || active?.other?.uid!==friendUid)return;
      console.warn('Online presence read unavailable:',error?.code||error?.message);
      peerPresence={lastActiveMs:0,loaded:false,error:error?.code||'unknown'};
      renderTypingPresence();
    }
  );
}
function friendIsOnline(now=Date.now()){
  return peerPresence.loaded && !peerPresence.error &&
    peerPresence.lastActiveMs>0 &&
    peerPresence.lastActiveMs<=now+30000 &&
    now-peerPresence.lastActiveMs<PRESENCE_ONLINE_MS;
}
function formatFriendLastSeen(ms,now=Date.now()){
  if(!Number.isFinite(ms) || ms<=0 || ms>now+30000)return 'Last seen unavailable';
  const when=new Date(ms),today=new Date(now);
  const date=when.toDateString(),todayDate=today.toDateString();
  const yesterday=new Date(today.getFullYear(),today.getMonth(),today.getDate()-1);
  const clock=when.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  if(date===todayDate)return 'Last seen today at '+clock;
  if(date===yesterday.toDateString())return 'Last seen yesterday at '+clock;
  return 'Last seen '+when.toLocaleDateString([],{day:'numeric',month:'short',year:'numeric'})+' at '+clock;
}
function friendPresenceText(){
  if(ownPresencePermissionError)return 'Online status unavailable · publish Firebase Rules';
  if(peerPresence.error==='permission-denied')return 'Online status unavailable · publish Firebase Rules';
  if(peerPresence.error)return 'Online status unavailable';
  if(!peerPresence.loaded){
    return navigator.onLine===false?'Online status unavailable · reconnect':'Checking online status…';
  }
  if(friendIsOnline())return 'Online';
  return peerPresence.lastActiveMs>0
    ?formatFriendLastSeen(peerPresence.lastActiveMs)
    :'Offline · last seen unavailable';
}

// Typing presence never stores draft text. Writes are throttled to one
// heartbeat per 4 seconds and stop after 2.8 seconds of inactivity.
// On-demand diagnostic: explicit Firestore read and write checks, no Cloudflare calls.
let typingDiagnosticOpen=false;
let typingDiagnosticRead='Waiting for friend listener';
let typingDiagnosticWrite='No signal sent yet';
let typingDiagnosticLast='No signal observed yet';
function typingErrorCode(error){
  return typeof error?.code==='string'?error.code:'unknown';
}
function displayTypingDiagnostics(){
  const panel=$('typingDiagnostics');
  if(!panel)return;
  panel.classList.toggle('hidden',!typingDiagnosticOpen);
  $('typingCheckToggle').setAttribute('aria-expanded',String(typingDiagnosticOpen));
  $('typingReadDiagnostic').textContent='Friend listener: '+typingDiagnosticRead;
  $('typingWriteDiagnostic').textContent='My signal: '+typingDiagnosticWrite;
  $('typingLastDiagnostic').textContent='Friend signal: '+typingDiagnosticLast;
}
function recordFriendTyping(data){
  const last=data?.updatedAt?.toDate?.();
  typingDiagnosticLast=data
    ?(data.active?'ACTIVE':'inactive')+(last?' · '+last.toLocaleTimeString(): ' · awaiting timestamp')
    :'No typing record yet';
  displayTypingDiagnostics();
}
$('typingCheckToggle').onclick=()=>{
  typingDiagnosticOpen=!typingDiagnosticOpen;
  displayTypingDiagnostics();
};
async function checkFriendTypingNow(){
  if(!active || !me)return;
  const threadId=active.id,peerUid=active.other.uid;
  typingDiagnosticRead='Direct server read in progress…';
  displayTypingDiagnostics();
  try{
    const snapshot=await getDocFromServer(doc(db,'threads',threadId,'typing',peerUid));
    if(!me || active?.id!==threadId || active?.other?.uid!==peerUid)return;
    const data=snapshot.data();
    typingDiagnosticRead='Direct server read OK ✓';
    typingReadError=false;
    remoteTyping={active:data?.active===true,updatedAt:data?.updatedAt?.toMillis?.()||0};
    recordFriendTyping(data);
    renderTypingPresence();
    scheduleRemoteTypingExpiry();
  }catch(error){
    console.warn('Direct typing check failed:',error);
    if(!me || active?.id!==threadId || active?.other?.uid!==peerUid)return;
    typingDiagnosticRead='Direct server read failed: '+typingErrorCode(error);
    typingReadError=true;
    displayTypingDiagnostics();
    renderTypingPresence();
  }
}
$('typingCheckRefresh').onclick=checkFriendTypingNow;
function runTypingTest(){
  if(!me || !active || document.hidden)return;
  const threadId=active.id,uid=me.uid;
  stopOwnTyping();
  ownTyping={threadId,uid};
  ownTypingLastSignal=Date.now();
  $('typingSendTest').disabled=true;
  typingDiagnosticWrite='Sending test signal to Firestore…';
  displayTypingDiagnostics();
  void queueTypingSignal(threadId,uid,true).then(result=>{
    if(!me || me.uid!==uid || active?.id!==threadId)return;
    if(!result?.ok){
      stopOwnTyping();
      $('typingSendTest').disabled=false;
      return;
    }
    if(ownTyping?.threadId!==threadId)return;
    if(ownTypingTimer!==null)clearTimeout(ownTypingTimer);
    ownTypingTimer=setTimeout(stopOwnTyping,12000);
  });
}
$('typingSendTest').onclick=runTypingTest;

const TYPING_IDLE_MS=5000,TYPING_REFRESH_MS=4000,TYPING_EXPIRE_MS=15000;
let ownTyping=null,ownTypingTimer=null,ownTypingLastSignal=0;
let typingUnsubscribe=null,typingExpiryTimer=null;
let remoteTyping={active:false,updatedAt:0};
let typingReadError=false,typingWriteError=false;
let typingWriteQueue=Promise.resolve();
function queueTypingSignal(threadId,uid,isActive){
  const send=async()=>{
    if(!me || me.uid!==uid)return {ok:false,code:'account-changed'};
    if(active?.id===threadId){
      typingDiagnosticWrite='Sending '+(isActive?'typing':'stopped')+'…';
      displayTypingDiagnostics();
    }
    try{
      await setDoc(doc(db,'threads',threadId,'typing',uid),
        {active:isActive,updatedAt:serverTimestamp()});
      if(active?.id===threadId && me?.uid===uid){
        typingWriteError=false;
        typingDiagnosticWrite=(isActive?'Typing ON':'Typing OFF')+' confirmed by Firestore ✓';
        renderTypingPresence();
        displayTypingDiagnostics();
      }
      return {ok:true};
    }catch(error){
      console.warn('Typing status unavailable:',error);
      if(active?.id===threadId && me?.uid===uid){
        typingWriteError=true;
        typingDiagnosticWrite='Write FAILED: '+typingErrorCode(error);
        renderTypingPresence();
        displayTypingDiagnostics();
      }
      return {ok:false,code:typingErrorCode(error)};
    }
  };
  typingWriteQueue=typingWriteQueue.then(send,send);
  return typingWriteQueue;
}
function stopOwnTyping(){
  if(ownTypingTimer!==null)clearTimeout(ownTypingTimer);
  ownTypingTimer=null;
  if(!ownTyping)return;
  const old=ownTyping;
  ownTyping=null;ownTypingLastSignal=0;
  if($('typingSendTest'))$('typingSendTest').disabled=false;
  void queueTypingSignal(old.threadId,old.uid,false);
}
function onOwnTypingInput(){
  if(editDraft){stopOwnTyping();return;}
  if(!me || !active || document.hidden || !$('messageInput').value.trim()){
    stopOwnTyping();return;
  }
  const threadId=active.id,uid=me.uid;
  if(ownTyping && (ownTyping.threadId!==threadId || ownTyping.uid!==uid))stopOwnTyping();
  const now=Date.now();
  if(!ownTyping || now-ownTypingLastSignal>=TYPING_REFRESH_MS){
    ownTyping={threadId,uid};
    ownTypingLastSignal=now;
    queueTypingSignal(threadId,uid,true);
  }
  if(ownTypingTimer!==null)clearTimeout(ownTypingTimer);
  ownTypingTimer=setTimeout(stopOwnTyping,TYPING_IDLE_MS);
}
$('messageInput').addEventListener('input',onOwnTypingInput);
function renderTypingPresence(){
  const label=$('chatPresence');
  const isFresh=remoteTyping.active && remoteTyping.updatedAt>0 &&
    Date.now()-remoteTyping.updatedAt<TYPING_EXPIRE_MS;
  const typingError=typingReadError||typingWriteError;
  // Typing stays the highest priority; unread/edit/reply state is untouched.
  const text=isFresh?'typing…'
    :typingError?'Typing unavailable · check Firestore Rules'
    :friendPresenceText();
  if(label.textContent!==text)label.textContent=text;
  label.classList.toggle('is-typing',isFresh);
  label.classList.toggle('is-online',!isFresh && !typingError && friendIsOnline() && !ownPresencePermissionError);
  label.classList.toggle('is-error',!isFresh &&
    (typingError || ownPresencePermissionError || !!peerPresence.error));
  $('chatTypingBubble')?.classList.toggle('hidden',!isFresh || document.hidden);
}
function scheduleRemoteTypingExpiry(){
  if(typingExpiryTimer!==null)clearTimeout(typingExpiryTimer);
  typingExpiryTimer=null;
  if(!remoteTyping.active || !remoteTyping.updatedAt)return;
  const remaining=remoteTyping.updatedAt+TYPING_EXPIRE_MS-Date.now();
  if(remaining<=0)return;
  typingExpiryTimer=setTimeout(()=>{
    typingExpiryTimer=null;
    renderTypingPresence();
  },Math.min(TYPING_EXPIRE_MS,remaining));
}
function closeTypingSession(){
  stopOwnTyping();
  if(typingUnsubscribe){typingUnsubscribe();typingUnsubscribe=null}
  if(typingExpiryTimer!==null)clearTimeout(typingExpiryTimer);
  typingExpiryTimer=null;
  remoteTyping={active:false,updatedAt:0};
  typingReadError=false;typingWriteError=false;
  typingDiagnosticOpen=false;
  typingDiagnosticRead='Waiting for friend listener';
  typingDiagnosticWrite='No signal sent yet';
  typingDiagnosticLast='No signal observed yet';
  if($('typingSendTest'))$('typingSendTest').disabled=false;
  displayTypingDiagnostics();
  renderTypingPresence();
}
function watchOtherTyping(threadId,otherUid){
  remoteTyping={active:false,updatedAt:0};
  typingDiagnosticRead='Connecting to Firestore…';
  typingDiagnosticLast='No signal received yet';
  displayTypingDiagnostics();
  renderTypingPresence();
  typingUnsubscribe=onSnapshot(
    doc(db,'threads',threadId,'typing',otherUid),
    {includeMetadataChanges:true},
    snapshot=>{
      if(active?.id!==threadId || active?.other?.uid!==otherUid || !me)return;
      const data=snapshot.data();
      remoteTyping={
        active:data?.active===true,
        updatedAt:data?.updatedAt?.toMillis?.()||0
      };
      typingReadError=false;
      typingDiagnosticRead=snapshot.metadata.fromCache
        ?'Local cache (waiting for server)'
        :'Listener connected to Firestore ✓';
      recordFriendTyping(data);
      renderTypingPresence();
      scheduleRemoteTypingExpiry();
    },
    error=>{
      console.warn('Could not watch typing status:',error);
      typingReadError=true;
      typingDiagnosticRead='Listener FAILED: '+typingErrorCode(error);
      typingDiagnosticLast='Not available';
      remoteTyping={active:false,updatedAt:0};
      displayTypingDiagnostics();
      renderTypingPresence();
      scheduleRemoteTypingExpiry();
    }
  );
}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden)stopOwnTyping();
  renderTypingPresence();
});
window.addEventListener('pagehide',stopOwnTyping);

function watchThreads(){
  stopThreads=onSnapshot(query(collection(db,'threads'),where('members','array-contains',me.uid)),snap=>{
    threads=snap.docs.map(d=>({id:d.id,...d.data()}));
    syncReceiptWatchers(threads);
    if(view==='chats')renderThreads();
  },e=>{if(view==='chats')$('emptyList').textContent='Could not load chats: '+e.message;});
}
function makePersonButton(u,click,preview='Tap to start private chat'){
  const b=el('button','conversation');b.type='button';
  const a=el('div','avatar',initials(u.username));
  const body=el('div','conversation-body');
  body.append(el('strong',null,'@'+(u.username||'user')),el('small',null,preview));
  b.append(a,body);b.onclick=click;return b;
}
async function getUser(uid){
  if(users.has(uid))return users.get(uid);
  const snap=await getDoc(doc(db,'users',uid));
  const u=snap.exists()?{uid,username:snap.data().username||'user'}:{uid,username:'user'};
  users.set(uid,u);return u;
}
async function renderThreads(){
  if(view!=='chats'||!me)return;
  const version=++threadVersion,nav=$('conversationList');
  $('listTitle').textContent='Your conversations';
  nav.replaceChildren();
  $('emptyList').textContent='No chats yet. Select People to start a private conversation.';
  $('emptyList').classList.toggle('hidden',threads.length>0);
  try{
    const items=await Promise.all([...threads].sort((a,b)=>(b.updatedAt?.toMillis?.()||0)-(a.updatedAt?.toMillis?.()||0)).map(async t=>{
      const other=t.members.find(id=>id!==me.uid);if(!other)return null;
      const u=await getUser(other);return {t,u};
    }));
    if(view!=='chats'||version!==threadVersion||!me)return;
    for(const item of items){if(item)nav.append(makePersonButton(item.u,()=>openChat(item.t.id,item.u),'Private conversation'));}
  }catch(e){if(version===threadVersion)$('emptyList').textContent='Could not load conversations: '+e.message;}
}
const DIRECTORY_PAGE_SIZE=50;
function showPeople(term=''){
  if(!me)return;
  setView('people');++threadVersion;
  const normalized=normalize(term);
  directoryTerm=normalized;
  directoryCursor=null;directoryFinished=false;directoryLoading=false;directoryCount=0;
  const current=++peopleVersion;
  const nav=$('conversationList');nav.replaceChildren();nav.scrollTop=0;
  $('listTitle').textContent=normalized?'Matching people':'All registered users';
  $('emptyList').textContent='Loading people…';$('emptyList').classList.remove('hidden');
  if(normalized && !/^[a-z][a-z0-9_]{0,19}$/.test(normalized)){
    $('emptyList').textContent='Search using letters, numbers and underscores.';
    directoryFinished=true;return;
  }
  loadMorePeople(current);
}
async function loadMorePeople(version=peopleVersion){
  if(!me||view!=='people'||directoryLoading||directoryFinished||version!==peopleVersion)return;
  directoryLoading=true;
  const nav=$('conversationList');
  let loadButton=nav.querySelector('.load-more-people');
  if(loadButton)loadButton.remove();
  $('emptyList').classList.remove('hidden');
  $('emptyList').textContent=directoryCount?'Loading more users…':'Loading people…';
  try{
    const terms=[orderBy(documentId())];
    if(directoryCursor)terms.push(startAfter(directoryCursor));
    else if(directoryTerm)terms.push(startAt(directoryTerm));
    if(directoryTerm)terms.push(endAt(directoryTerm+'\uf8ff'));
    terms.push(limit(DIRECTORY_PAGE_SIZE));
    const snap=await getDocs(query(collection(db,'handles'),...terms));
    if(version!==peopleVersion||view!=='people'||!me)return;
    const docs=snap.docs;
    if(docs.length)directoryCursor=docs[docs.length-1];
    directoryFinished=docs.length<DIRECTORY_PAGE_SIZE;
    for(const document of docs){
      const uid=document.data().uid;
      if(uid===me.uid)continue;
      const u={uid,username:document.id};
      users.set(uid,u);
      nav.append(makePersonButton(u,()=>startChat(u)));
      directoryCount++;
    }
    if(directoryCount===0){
      $('emptyList').textContent=directoryTerm?'No matching username found.':'No other registered users yet. Share your @username with a friend!';
      $('emptyList').classList.remove('hidden');
    }else $('emptyList').classList.add('hidden');
    if(!directoryFinished){
      loadButton=el('button','load-more-people','Show more people');
      loadButton.type='button';loadButton.onclick=()=>loadMorePeople();nav.append(loadButton);
    }
  }catch(e){
    if(version===peopleVersion){
      $('emptyList').textContent='Could not load people: '+e.message;
      $('emptyList').classList.remove('hidden');
    }
  }finally{if(version===peopleVersion)directoryLoading=false;}
}
$('conversationList').addEventListener('scroll',()=>{
  if(view!=='people'||directoryFinished||directoryLoading)return;
  const n=$('conversationList');
  if(n.scrollTop+n.clientHeight>=n.scrollHeight-160)loadMorePeople();
});
$('peopleTab').onclick=()=>{ $('searchInput').value='';showPeople(''); };
$('chatsTab').onclick=()=>{ ++peopleVersion;directoryLoading=false;$('searchInput').value='';setView('chats');renderThreads(); };
$('newChatBtn').onclick=$('mobileNewChat').onclick=()=>{ $('searchInput').value='';showPeople('');$('searchInput').focus(); };
$('allChatsBtn').onclick=()=>{$('chatsTab').click();};
let searchTimer;
$('searchInput').oninput=()=>{
  clearTimeout(searchTimer);
  searchTimer=setTimeout(()=>{
    if(!$('searchInput').value.trim() && view==='chats')return renderThreads();
    showPeople($('searchInput').value);
  },250);
};
async function startChat(u){try{const id=pair(me.uid,u.uid);await setDoc(doc(db,'threads',id),{members:[me.uid,u.uid].sort(),updatedAt:serverTimestamp()},{merge:true});openChat(id,u)}catch(e){alert('Could not create chat: '+e.message)}}
// A single emoji grapheme (including skin tones, family ZWJ sequences,
// regional-indicator flags, and keycap emoji) gets a bubble-free large display.
// Text mixed with emojis and messages containing multiple emojis stay normal.
const singleEmojiSegmenter=typeof Intl.Segmenter==='function'
  ?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
function isSingleEmojiMessage(value){
  const text=String(value||'').trim();
  if(!text||!singleEmojiSegmenter)return false;
  const iterator=singleEmojiSegmenter.segment(text)[Symbol.iterator]();
  const first=iterator.next();
  if(first.done||!iterator.next().done)return false;
  const grapheme=first.value.segment;
  return /\p{Extended_Pictographic}/u.test(grapheme) ||
    /^\p{Regional_Indicator}{2}$/u.test(grapheme) ||
    /^[0-9#*]\uFE0F?\u20E3$/u.test(grapheme);
}


const EDIT_WINDOW_MS=15*60*1000;
let editDraft=null;
let replyDraft=null,actionMenu=null;
function clearReply(){
  replyDraft=null;
  $('replyPreview').classList.add('hidden');
  $('replyPreviewAuthor').textContent='';
  $('replyPreviewText').textContent='';
}
$('cancelReply').onclick=clearReply;
function authorFor(uid){return uid===me?.uid?'You':'@'+(active?.other?.username||'User')}

function canEditMessage(item,message){
  const createdMs=message?.createdAt?.toMillis?.();
  return !!me && message?.senderId===me.uid &&
    !item?.metadata?.hasPendingWrites &&
    typeof createdMs==='number' &&
    createdMs<=Date.now() && Date.now()-createdMs<EDIT_WINDOW_MS;
}
function stopEditing(restore=true){
  if(!editDraft)return;
  const previous=editDraft;
  editDraft=null;
  animatedMessages.setEditing(false);
  $('editPreview').classList.add('hidden');
  $('messageForm').classList.remove('editing-message');
  $('sendBtn').textContent='➤';
  $('sendBtn').setAttribute('aria-label','Send message');
  $('messageInput').placeholder='Write a personal message…';
  if(restore && active?.id===previous.threadId){
    $('messageInput').value=previous.previousInput;
    if(previous.previousReply){
      replyDraft=previous.previousReply;
      $('replyPreviewAuthor').textContent='Replying to '+authorFor(replyDraft.senderId);
      $('replyPreviewText').textContent=replyDraft.text;
      $('replyPreview').classList.remove('hidden');
    }
  }else if(!restore){
    $('messageInput').value='';
  }
}
$('cancelEdit').onclick=()=>stopEditing(true);
function startEdit(item,message,threadId){
  if(!me || active?.id!==threadId || message.senderId!==me.uid)return;
  if(!canEditMessage(item,message)){
    status('Messages can only be edited within 15 minutes of sending.');
    closeActions();return;
  }
  if(editDraft)stopEditing(true);
  // Editing preserves the original animation; sending a new effect is disabled.
  animatedMessages.setEditing(true);
  const previousInput=$('messageInput').value;
  const previousReply=replyDraft;
  if(previousReply)clearReply();
  editDraft={
    threadId,id:item.id,originalText:message.text,
    createdAtMs:message.createdAt.toMillis(),
    previousInput,previousReply
  };
  stopOwnTyping();
  $('messageInput').value=message.text;
  $('messageInput').placeholder='Edit your message…';
  $('editPreview').classList.remove('hidden');
  $('messageForm').classList.add('editing-message');
  $('sendBtn').textContent='✓';
  $('sendBtn').setAttribute('aria-label','Save edited message');
  closeActions();
  $('messageInput').focus();
}
async function submitMessageEdit(){
  const selected=editDraft;
  if(!selected || !me || active?.id!==selected.threadId)return;
  const text=clean($('messageInput').value);
  if(!text){status('Edited message cannot be empty.');return}
  if(text===selected.originalText){status('Change the message before saving.');return}
  if(Date.now()-selected.createdAtMs>=EDIT_WINDOW_MS){
    status('The 15-minute edit window has expired. Cancel to return to chat.');return;
  }
  $('sendBtn').disabled=true;
  status('Saving edited message…');
  try{
    await updateDoc(doc(db,'threads',selected.threadId,'messages',selected.id),
      {text,editedAt:serverTimestamp()});
    if(editDraft===selected && active?.id===selected.threadId){
      // Keep an unsent reply draft valid if it quotes this exact edited message.
      if(selected.previousReply?.id===selected.id){
        selected.previousReply={...selected.previousReply,text};
      }
      stopEditing(true);
      status('Message edited');
    }
  }catch(error){
    if(error?.code==='permission-denied'){
      status('Edit blocked by Firebase rules. The new Edit Message rules must be published.');
    }else{
      status('Could not edit message: '+error.message);
    }
  }finally{
    $('sendBtn').disabled=false;
  }
}

function startReply(item,message,threadId){
  if(!me || active?.id!==threadId)return;
  if(editDraft)stopEditing(true);
  if(item.metadata?.hasPendingWrites){status('Wait for this message to send first.');return}
  replyDraft={threadId,id:item.id,senderId:message.senderId,text:message.text};
  $('replyPreviewAuthor').textContent='Replying to '+authorFor(message.senderId);
  $('replyPreviewText').textContent=message.text;
  $('replyPreview').classList.remove('hidden');
  closeActions();
  $('messageInput').focus();
}
function jumpToOriginal(id){
  const target=[...$('messages').children].find(n=>n.dataset.messageId===id);
  if(!target){status('Original message was deleted or is older than the latest 300.');return}
  target.scrollIntoView({behavior:'smooth',block:'center'});
  target.classList.remove('reply-highlight');
  void target.offsetWidth;
  target.classList.add('reply-highlight');
}


const REACTION_OPTIONS=[
  ['❤️','Heart'],['😂','Laugh'],['👍','Like'],
  ['😮','Surprised'],['😢','Sad'],['🙏','Thanks']
];
// Reactions share the existing message listener; no per-message listeners,
// separate documents, or extra Cloudflare requests are necessary.
const reactionWrites=new Set();
// Snapshot updates can overwrite the ordinary status line just as Firestore
// rolls an optimistic reaction back. Keep backend errors in a separate banner.
function clearReactionSaveError(){
  $('reactionSaveError').classList.add('hidden');
  $('reactionSaveErrorText').textContent='';
}
function showReactionSaveError(error){
  const message=error?.code==='permission-denied'
    ?'Reaction was NOT saved. Firebase denied permission. The site owner needs to publish the latest Firestore reaction rules.'
    :'Reaction was NOT saved: '+(error?.message||'Unknown error');
  $('reactionSaveErrorText').textContent=message;
  $('reactionSaveError').classList.remove('hidden');
  status('Reaction not saved');
}
$('reactionErrorDismiss').onclick=clearReactionSaveError;
function messageReactions(message){
  const value=message?.reactions;
  return value && typeof value==='object' && !Array.isArray(value)?value:{};
}
function myMessageReaction(message){
  const reactions=messageReactions(message);
  return me && Object.prototype.hasOwnProperty.call(reactions,me.uid)
    ?reactions[me.uid]:null;
}
async function toggleMessageReaction(item,threadId,emoji){
  // Every fully-qualified Unicode emoji is accepted, not just the quick six.
  // isSingleEmojiMessage recognizes emoji ZWJ families, flags and skin tones.
  if(!me || active?.id!==threadId ||
     typeof emoji!=='string' || emoji.length>32 ||
     !isSingleEmojiMessage(emoji))return;
  if(item.metadata?.hasPendingWrites){
    status('Wait for this message to finish sending.');
    closeActions();return;
  }
  const uid=me.uid,key=threadId+'/'+item.id+'/'+uid;
  if(reactionWrites.has(key))return;
  const previous=myMessageReaction(item.data());
  closeActions();
  reactionWrites.add(key);
  try{
    // FieldPath isolates this user's map key so another participant's
    // simultaneous reaction cannot be overwritten.
    await updateDoc(doc(db,'threads',threadId,'messages',item.id),
      new FieldPath('reactions',uid),
      previous===emoji?deleteField():emoji);
    if(me?.uid===uid && active?.id===threadId)clearReactionSaveError();
  }catch(error){
    if(me?.uid===uid && active?.id===threadId)showReactionSaveError(error);
  }finally{
    reactionWrites.delete(key);
  }
}
function reactionChoices(item,message,threadId){
  const row=el('div','reaction-choices');
  row.setAttribute('role','group');
  row.setAttribute('aria-label','Choose reaction');
  const mine=myMessageReaction(message);
  for(const [emoji,label] of REACTION_OPTIONS){
    const button=el('button','reaction-choice'+(mine===emoji?' is-selected':''),emoji);
    button.type='button';
    button.title=mine===emoji?'Remove '+label+' reaction':'React '+label;
    button.setAttribute('aria-label',button.title);
    button.setAttribute('aria-pressed',String(mine===emoji));
    button.onclick=()=>{void toggleMessageReaction(item,threadId,emoji)};
    row.append(button);
  }
  const more=el('button','reaction-choice reaction-more','＋');
  more.type='button';
  more.title='Browse all emojis';
  more.setAttribute('aria-label','Browse all emojis');
  more.onclick=()=>showAllEmojiPicker(
    emoji=>{void toggleMessageReaction(item,threadId,emoji)},threadId);
  row.append(more);
  return row;
}
function renderReactionChips(item,message,threadId){
  const reactions=messageReactions(message);
  const values=Object.values(reactions).filter(value=>
    typeof value==='string' && value.length<=32 && isSingleEmojiMessage(value)
  );
  if(!values.length)return null;
  const chips=el('div','message-reactions');
  chips.setAttribute('aria-label','Message reactions');
  const mine=myMessageReaction(message);
  const counts=new Map();
  for(const emoji of values)counts.set(emoji,(counts.get(emoji)||0)+1);
  for(const [emoji,count] of counts){
    const chip=el('button','reaction-chip'+(mine===emoji?' mine':''),emoji+' '+count);
    chip.type='button';
    chip.title=mine===emoji?'Remove your reaction':'React with '+emoji;
    chip.setAttribute('aria-label',chip.title+', '+count+' total');
    chip.setAttribute('aria-pressed',String(mine===emoji));
    chip.onclick=()=>{void toggleMessageReaction(item,threadId,emoji)};
    chips.append(chip);
  }
  return chips;
}

// Full Unicode Emoji 17.0 catalog is bundled locally and loaded only when
// requested. No third-party script receives access to private chats.
const RECENT_EMOJIS_KEY='openchat-recent-emojis-v1';
let emojiGroupsPromise=null;
function loadEmojiGroups(){
  if(!emojiGroupsPromise){
    emojiGroupsPromise=import('./emoji-data.js?v=emoji17-20261012')
      .then(module=>module.EMOJI_GROUPS)
      .catch(error=>{emojiGroupsPromise=null;throw error});
  }
  return emojiGroupsPromise;
}
function recentEmojiValues(){
  try{
    const list=JSON.parse(localStorage.getItem(RECENT_EMOJIS_KEY)||'[]');
    return Array.isArray(list)
      ?list.filter(emoji=>typeof emoji==='string' &&
        emoji.length<=32 && isSingleEmojiMessage(emoji)).slice(0,24)
      :[];
  }catch{return []}
}
function rememberEmoji(emoji){
  if(!isSingleEmojiMessage(emoji))return;
  try{
    const recent=recentEmojiValues().filter(value=>value!==emoji);
    localStorage.setItem(RECENT_EMOJIS_KEY,JSON.stringify([emoji,...recent].slice(0,24)));
  }catch{}
}
function showAllEmojiPicker(onSelect,threadId){
  if(!me || active?.id!==threadId)return;
  const initialUid=me.uid;
  closeActions();
  const backdrop=el('div','all-emoji-backdrop');
  backdrop.onclick=event=>{if(event.target===backdrop)closeActions()};
  const panel=el('section','all-emoji-panel');
  panel.setAttribute('role','dialog');
  panel.setAttribute('aria-modal','true');
  panel.setAttribute('aria-label','All emojis');
  const header=el('div','all-emoji-header');
  header.append(el('strong',null,'Choose an emoji'));
  const close=el('button','all-emoji-close','×');
  close.type='button';close.title='Close emoji picker';
  close.setAttribute('aria-label','Close emoji picker');
  close.onclick=closeActions;
  header.append(close);
  const search=el('input','all-emoji-search');
  search.type='search';search.autocomplete='off';
  search.placeholder='Search all emojis…';
  search.setAttribute('aria-label','Search all emojis');
  const categories=el('div','all-emoji-categories');
  categories.setAttribute('role','tablist');
  categories.setAttribute('aria-label','Emoji categories');
  const tones=el('div','all-emoji-tones');
  tones.setAttribute('aria-label','Skin tone options');
  const results=el('div','all-emoji-results');
  results.append(el('p','all-emoji-loading','Loading emoji library…'));
  const footer=el('div','all-emoji-footer');
  footer.textContent='Unicode Emoji 17.0';
  panel.append(header,search,categories,tones,results,footer);
  backdrop.append(panel);
  document.body.append(backdrop);
  actionMenu=backdrop;
  search.focus({preventScroll:true});

  void loadEmojiGroups().then(groups=>{
    if(actionMenu!==backdrop || active?.id!==threadId || me?.uid!==initialUid)return;
    const all=groups.flatMap(group=>
      group.emojis.map(([emoji,name])=>[emoji,name,group.name]));
    const known=new Map(all.map(row=>[row[0],row]));
    const modifiers=['🏻','🏼','🏽','🏾','🏿'];
    const toneOptions=[
      ['all','All tones','🌈'],['base','Default','✋'],
      ['🏻','Light','✋🏻'],['🏼','Light-medium','✋🏼'],
      ['🏽','Medium','✋🏽'],['🏾','Dark-medium','✋🏾'],
      ['🏿','Dark','✋🏿']
    ];
    const groupsWithRecent=[{name:'Recent',icon:'🕘'},...groups];
    let category=groups[0].name,tone='all',shown=112;
    function matchesTone(emoji){
      if(tone==='all')return true;
      const hasModifier=modifiers.some(value=>emoji.includes(value));
      return tone==='base'?!hasModifier:!hasModifier||emoji.includes(tone);
    }
    function renderCategories(){
      categories.replaceChildren();
      for(const group of groupsWithRecent){
        const selected=category===group.name;
        const button=el('button','all-emoji-category'+(selected?' active':''),group.icon);
        button.type='button';
        button.title=group.name;
        button.setAttribute('role','tab');
        button.setAttribute('aria-label',group.name);
        button.setAttribute('aria-selected',String(selected));
        button.onclick=()=>{
          category=group.name;search.value='';shown=112;
          renderCategories();renderResults();
        };
        categories.append(button);
      }
    }
    function renderTones(){
      tones.replaceChildren();
      for(const [value,label,icon] of toneOptions){
        const selected=tone===value;
        const button=el('button','all-emoji-tone'+(selected?' active':''),icon);
        button.type='button';button.title=label;
        button.setAttribute('aria-label','Skin tone: '+label);
        button.setAttribute('aria-pressed',String(selected));
        button.onclick=()=>{tone=value;shown=112;renderTones();renderResults()};
        tones.append(button);
      }
    }
    function renderResults(){
      if(actionMenu!==backdrop)return;
      const query=search.value.trim().toLowerCase();
      let matches;
      if(query){
        const words=query.split(/\s+/);
        matches=all.filter(([emoji,name,group])=>{
          const info=(name+' '+group).toLowerCase();
          return words.every(word=>info.includes(word)||emoji.includes(word));
        });
      }else if(category==='Recent'){
        matches=recentEmojiValues().map(emoji=>
          known.get(emoji)||[emoji,'Recently used emoji','Recent']);
      }else{
        const group=groups.find(x=>x.name===category);
        matches=group?group.emojis.map(([emoji,name])=>[emoji,name,category]):[];
      }
      matches=matches.filter(([emoji])=>matchesTone(emoji));
      const previousScroll=results.scrollTop;
      results.replaceChildren();
      if(!matches.length){
        results.append(el('p','all-emoji-no-results',
          query?'No emojis match your search.':'No emojis in this category yet.'));
      }else{
        const grid=el('div','all-emoji-grid');
        const fragment=document.createDocumentFragment();
        for(const [emoji,name] of matches.slice(0,shown)){
          const button=el('button','all-emoji-cell',emoji);
          button.type='button';button.title=name;
          button.setAttribute('aria-label',name);
          button.onclick=()=>{
            if(!me || me.uid!==initialUid || active?.id!==threadId)return;
            rememberEmoji(emoji);
            onSelect(emoji);
            closeActions();
          };
          fragment.append(button);
        }
        grid.append(fragment);results.append(grid);
        if(matches.length>shown){
          const more=el('button','all-emoji-load-more','Show more emojis');
          more.type='button';
          more.onclick=()=>{shown+=112;renderResults()};
          results.append(more);
        }
      }
      results.scrollTop=previousScroll;
      footer.textContent='Showing '+Math.min(shown,matches.length)+' of '+
        matches.length+' · '+all.length.toLocaleString()+' emojis available';
    }
    search.oninput=()=>{shown=112;results.scrollTop=0;renderResults()};
    renderCategories();renderTones();renderResults();
  }).catch(error=>{
    console.warn('Emoji catalog unavailable:',error);
    if(actionMenu!==backdrop)return;
    results.replaceChildren(el('p','all-emoji-no-results',
      'Could not load the complete emoji library. You can still use quick reactions.'));
    const quick=el('div','all-emoji-grid');
    for(const [emoji,label] of REACTION_OPTIONS){
      const button=el('button','all-emoji-cell',emoji);
      button.type='button';button.title=label;
      button.onclick=()=>{onSelect(emoji);closeActions()};
      quick.append(button);
    }
    results.append(quick);
    footer.textContent='Quick reactions available';
  });
}
function insertEmojiIntoMessage(emoji){
  const input=$('messageInput');
  if(!input || !isSingleEmojiMessage(emoji))return;
  const start=typeof input.selectionStart==='number'
    ?input.selectionStart:input.value.length;
  const end=typeof input.selectionEnd==='number'
    ?input.selectionEnd:start;
  if(input.value.length-(end-start)+emoji.length>1000){
    status('Messages can contain up to 1000 characters.');return;
  }
  input.setRangeText(emoji,start,end,'end');
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.focus();
}
$('composerEmojiBtn').onclick=()=>{
  if(!me || !active)return;
  showAllEmojiPicker(insertEmojiIntoMessage,active.id);
};

function showReactionPicker(item,message,node,threadId){
  if(!me || active?.id!==threadId)return;
  closeActions();
  const menu=el('div','message-action-menu reaction-action-menu');
  menu.setAttribute('role','group');
  menu.setAttribute('aria-label','React to this message');
  menu.append(reactionChoices(item,message,threadId));
  const cancel=el('button','reaction-cancel','Cancel');
  cancel.type='button';cancel.onclick=closeActions;
  menu.append(cancel);
  document.body.append(menu);actionMenu=menu;
  if(window.innerWidth>700){
    const rect=node.getBoundingClientRect();
    menu.style.top=Math.min(Math.max(8,rect.top),window.innerHeight-124)+'px';
    menu.style.left=Math.min(Math.max(8,rect.left),window.innerWidth-338)+'px';
  }
  menu.querySelector('.reaction-choice')?.focus({preventScroll:true});
}

function closeActions(){if(actionMenu){actionMenu.remove();actionMenu=null}}
function showActions(item,message,node,threadId){
  if(!me || active?.id!==threadId)return;
  closeActions();
  const menu=el('div','message-action-menu');
  menu.setAttribute('role','group');menu.setAttribute('aria-label','Message actions');
  const reply=el('button','primary-action','↩ Reply');
  reply.type='button';reply.onclick=()=>startReply(item,message,threadId);
  const editAllowed=canEditMessage(item,message);
  const edit=editAllowed?el('button',null,'✎ Edit message'):null;
  if(edit){edit.type='button';edit.onclick=()=>startEdit(item,message,threadId)}
  const copy=el('button',null,'Copy message');
  copy.type='button';copy.onclick=async()=>{
    closeActions();
    try{await navigator.clipboard.writeText(message.text)}
    catch(error){status('Copy unavailable: '+error.message)}
  };
  const cancel=el('button',null,'Cancel');
  cancel.type='button';cancel.onclick=closeActions;
  menu.append(reactionChoices(item,message,threadId),reply);
  if(edit)menu.append(edit);
  menu.append(copy,cancel);
  document.body.append(menu);actionMenu=menu;
  if(window.innerWidth>700){
    const rect=node.getBoundingClientRect();
    menu.style.top=Math.min(Math.max(8,rect.top),window.innerHeight-(editAllowed?322:270))+'px';
    menu.style.left=Math.min(Math.max(8,rect.right+8),window.innerWidth-338)+'px';
  }
  reply.focus({preventScroll:true});
}
document.addEventListener('pointerdown',event=>{
  if(actionMenu && !actionMenu.contains(event.target))closeActions();
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){
    if(actionMenu)closeActions();
    else if(replyDraft)clearReply();
  }
});


function enableReplyGesture(node,item,message,threadId){
  let touch=null,hold=null;
  const stopHold=()=>{if(hold!==null){clearTimeout(hold);hold=null}};
  const reset=()=>{
    stopHold();
    node.style.transform='';
    node.style.transition='';
    node.classList.remove('swiping-reply');
    touch=null;
  };
  node.addEventListener('touchstart',event=>{
    if(event.touches.length!==1 || event.target.closest('button'))return;
    const finger=event.touches[0];
    touch={x:finger.clientX,y:finger.clientY,dx:0,cancelled:false,held:false};
    stopHold();
    hold=setTimeout(()=>{
      hold=null;
      if(touch && !touch.cancelled && Math.abs(touch.dx)<12){
        touch.held=true;
        showActions(item,message,node,threadId);
      }
    },530);
  },{passive:true});
  node.addEventListener('touchmove',event=>{
    if(!touch || event.touches.length!==1)return;
    const finger=event.touches[0];
    const dx=finger.clientX-touch.x,dy=finger.clientY-touch.y;
    touch.dx=dx;
    if(touch.held)return;
    if(Math.abs(dy)>19 || dx>15){touch.cancelled=true;stopHold()}
    if(Math.abs(dx)>12)stopHold();
    if(touch.cancelled || Math.abs(dy)>36)return;
    const slide=Math.min(72,Math.max(0,-dx));
    if(slide>4){
      node.style.transition='none';
      node.style.transform='translateX(-'+slide+'px)';
      node.classList.add('swiping-reply');
    }
  },{passive:true});
  node.addEventListener('touchend',()=>{
    if(!touch)return;
    const swiped=!touch.held && !touch.cancelled && touch.dx<=-62;
    reset();
    if(swiped)startReply(item,message,threadId);
  },{passive:true});
  node.addEventListener('touchcancel',reset,{passive:true});
  node.addEventListener('contextmenu',event=>{
    if(event.target.closest('button'))return;
    event.preventDefault();
    showActions(item,message,node,threadId);
  });
}

function createQuote(replyTo){
  if(!replyTo || typeof replyTo.id!=='string' || typeof replyTo.text!=='string')return null;
  const q=el('button','reply-quote');q.type='button';
  q.title='Jump to original message';
  q.append(el('span','reply-quote-author',authorFor(replyTo.senderId)),el('span','reply-quote-text',replyTo.text));
  q.onclick=()=>jumpToOriginal(replyTo.id);
  return q;
}

function openChat(id,u){
  ticTacToe.close();
  quickQuiz.close();
  liveDoodle.close();
  animatedMessages.beginChat(id);
  messageEffects.close();
  if(stopMessages)stopMessages();
  stopFriendPresence();
  clearReactionSaveError();
  stopEditing(false);
  closeTypingSession();
  clearReply();closeActions();
  active={id,other:u};
  $('chatWelcome').classList.add('hidden');
  $('chatView').classList.remove('hidden');
  $('appShell').classList.add('chat-open');
  $('chatName').textContent='@'+(u.username||'user');
  $('chatAvatar').textContent=initials(u.username);
  watchOtherTyping(id,u.uid);
  watchFriendPresence(id,u.uid);
  ticTacToe.open(id,me.uid,u.uid,u.username);
  // Read-only doodle marks are visible over messages without entering draw
  // mode; touching the pen button enables canvas pointer capture.
  liveDoodle.connect(id,me.uid,u.uid,u.username);
  messageEffects.open(id,me.uid);
  $('messages').replaceChildren();
  visibleChatDocuments=[];
  status('Loading messages…');
  const ownUid=me.uid;
  stopMessages=onSnapshot(
    query(collection(db,'threads',id,'messages'),orderBy('createdAt','desc'),limit(300)),
    {includeMetadataChanges:true},
    snapshot=>{
      if(me?.uid!==ownUid || active?.id!==id)return;
      const container=$('messages');
      messageEffects.beforeMessagesRender();
      // Reactions use the same message stream. Preserve scroll position
      // on a reaction/edit update rather than jumping to the newest message.
      const atBottom=container.scrollHeight-container.scrollTop-container.clientHeight<96;
      const previousScrollTop=container.scrollTop;
      container.replaceChildren();
      const messages=snapshot.docs.slice().reverse();
      visibleChatDocuments=messages;
      for(const item of messages){
        const message=item.data(),own=message.senderId===ownUid;
        const node=el('article','msg'+(own?' own':'')+(!message.replyTo && isSingleEmojiMessage(message.text)?' emoji-only':''));
        node.dataset.messageId=item.id;
        const quote=createQuote(message.replyTo);
        if(quote)node.append(quote);
        node.append(el('div','msg-body',message.text));
        const reactionChips=renderReactionChips(item,message,id);
        if(reactionChips)node.append(reactionChips);
        enableReplyGesture(node,item,message,id);
        const meta=el('div','msg-meta');
        const when=message.createdAt?.toDate?.();
        meta.append(el('span',null,when?when.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'Sending…'));
        if(message.editedAt)meta.append(el('span','edited-mark','edited'));
        const replyButton=el('button','reply-trigger','↩');
        replyButton.type='button';
        replyButton.title='Reply to this message';
        replyButton.setAttribute('aria-label','Reply to this message');
        replyButton.onclick=()=>startReply(item,message,id);
        meta.append(replyButton);
        const reactButton=el('button','react-trigger','☺');
        reactButton.type='button';
        reactButton.title='React to this message';
        reactButton.setAttribute('aria-label','React to this message');
        reactButton.onclick=()=>showReactionPicker(item,message,node,id);
        meta.append(reactButton);
        if(own){
          const state=outgoingReceiptState(message,!!item.metadata?.hasPendingWrites);
          const ticks=el('span','receipt-ticks receipt-'+state,state==='sending'?'◷':state==='sent'?'✓':'✓✓');
          const label={sending:'Sending',sent:'Sent',delivered:'Delivered',seen:'Seen'}[state];
          ticks.title=label;ticks.setAttribute('role','img');ticks.setAttribute('aria-label',label);
          meta.append(ticks);
          if(canEditMessage(item,message)){
            const editButton=el('button','edit-msg','✎');
            editButton.type='button';
            editButton.title='Edit message (15 minutes)';
            editButton.setAttribute('aria-label','Edit message');
            editButton.onclick=()=>startEdit(item,message,id);
            meta.append(editButton);
          }
          const del=el('button','delete-msg','🗑');
          del.title='Delete message';
          del.onclick=async()=>{
            if(confirm('Delete this message?')){
              try{await deleteDoc(doc(db,'threads',id,'messages',item.id))}
              catch(error){status(error.message)}
            }
          };
          meta.append(del);
        }
        messageEffects.decorate(meta,node,item,message);
        node.append(meta);
        container.append(node);
      }
      container.scrollTop=atBottom?container.scrollHeight:previousScrollTop;
      if(!snapshot.metadata.fromCache)markVisibleChatSeen();
      status('Private chat • latest 300 messages');
    },
    error=>status('Could not load messages: '+error.message)
  );
}
$('backToChats').onclick=()=>{ticTacToe.close();quickQuiz.close();liveDoodle.close();animatedMessages.endChat();messageEffects.close();stopEditing(false);stopFriendPresence();closeTypingSession();clearReply();closeActions();$('appShell').classList.remove('chat-open')};
$('messageForm').onsubmit=async event=>{
  event.preventDefault();
  if(editDraft){await submitMessageEdit();return}
  if(!active||!me)return;
  const text=clean($('messageInput').value);
  if(!text)return;
  const threadId=active.id,sender=me,chosen=replyDraft?.threadId===active.id?replyDraft:null;
  const payload={senderId:sender.uid,text,createdAt:serverTimestamp()};
  const chosenEffect=animatedMessages.currentEffect();
  if(chosenEffect)payload.effect=chosenEffect;
  if(chosen)payload.replyTo={id:chosen.id,senderId:chosen.senderId,text:chosen.text};
  stopOwnTyping();
  $('sendBtn').disabled=true;status('Sending…');
  animatedMessages.clearSendError();
  try{
    const sent=await addDoc(collection(db,'threads',threadId,'messages'),payload);
    if(active?.id===threadId){
      $('messageInput').value='';
      animatedMessages.clearSentEffect(chosenEffect);
      if(chosen && replyDraft===chosen)clearReply();
      status('Sent');
    }
    void notifyRecipient(threadId,sent.id,sender);
  }catch(error){
    if(chosenEffect)animatedMessages.showSendError(error);
    status('Send failed: '+error.message);
  }
  finally{$('sendBtn').disabled=false}
};
