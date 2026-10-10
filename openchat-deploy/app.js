import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,signInWithRedirect,getRedirectResult,onAuthStateChanged,signOut,setPersistence,browserLocalPersistence} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {getFirestore,doc,setDoc,getDoc,collection,query,where,getDocs,limit,onSnapshot,addDoc,deleteDoc,serverTimestamp,orderBy,documentId,startAt,startAfter,endAt,runTransaction} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import {firebaseConfig} from './firebase-config.js';
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app),provider=new GoogleAuthProvider();
// Store Firebase's own auth session across tab closes, Back navigation and browser relaunch.
// Never save Firebase credentials or ID tokens manually in localStorage.
const persistenceReady=setPersistence(auth,browserLocalPersistence).then(()=>true).catch(error=>{
  console.warn('Persistent authentication storage is unavailable:',error);
  return false;
});
const $=id=>document.getElementById(id);let me=null,active=null,stopMessages=null,stopThreads=null,users=new Map(),threads=[];let view='people',directoryCursor=null,directoryTerm='',directoryLoading=false,directoryFinished=false,directoryCount=0,peopleVersion=0,threadVersion=0;
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
  const persistent=await persistenceReady;
  if(!persistent)feedback('This browser could not save a persistent login. Check Chrome site data settings if you are signed out after closing it.');
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
function watchThreads(){
  stopThreads=onSnapshot(query(collection(db,'threads'),where('members','array-contains',me.uid)),snap=>{
    threads=snap.docs.map(d=>({id:d.id,...d.data()}));
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
function openChat(id,u){if(stopMessages)stopMessages();active={id,other:u};$('chatWelcome').classList.add('hidden');$('chatView').classList.remove('hidden');$('appShell').classList.add('chat-open');$('chatName').textContent='@'+(u.username||'user');$('chatAvatar').textContent=initials(u.username);$('messages').replaceChildren();status('Loading messages…');stopMessages=onSnapshot(query(collection(db,'threads',id,'messages'),orderBy('createdAt','desc'),limit(300)),snap=>{const container=$('messages');container.replaceChildren();const arr=snap.docs.slice().reverse();for(const item of arr){const m=item.data(),own=m.senderId===me.uid;const node=el('article','msg'+(own?' own':''));node.append(el('div','msg-body',m.text));const meta=el('div','msg-meta');const d=m.createdAt?.toDate?.();meta.append(el('span',null,d?d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'Sending…'));if(own){const del=el('button','delete-msg','🗑');del.title='Delete message';del.onclick=async()=>{if(confirm('Delete this message?'))try{await deleteDoc(doc(db,'threads',id,'messages',item.id))}catch(e){status(e.message)}};meta.append(del)}node.append(meta);container.append(node)}container.scrollTop=container.scrollHeight;status('Private chat • latest 300 messages')},e=>status('Could not load messages: '+e.message))}
$('backToChats').onclick=()=>{$('appShell').classList.remove('chat-open')};
$('messageForm').onsubmit=async e=>{e.preventDefault();if(!active||!me)return;const text=clean($('messageInput').value);if(!text)return;const id=active.id, sender=me;$('sendBtn').disabled=true;status('Sending…');try{const sent=await addDoc(collection(db,'threads',id,'messages'),{senderId:sender.uid,text,createdAt:serverTimestamp()});$('messageInput').value='';status('Sent');void notifyRecipient(id,sent.id,sender)}catch(err){status('Send failed: '+err.message)}finally{$('sendBtn').disabled=false}};
