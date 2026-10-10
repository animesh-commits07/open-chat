import {initializeApp} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,signInWithRedirect,getRedirectResult,onAuthStateChanged,signOut} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {getFirestore,doc,setDoc,getDoc,collection,query,where,getDocs,limit,onSnapshot,addDoc,deleteDoc,serverTimestamp,orderBy,documentId,startAt,endAt,runTransaction} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import {firebaseConfig} from './firebase-config.js';
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app),provider=new GoogleAuthProvider();
const $=id=>document.getElementById(id);let me=null,active=null,stopMessages=null,stopThreads=null,users=new Map(),threads=[];
const validUsername=u=>typeof u==='string'&&/^[a-z][a-z0-9_]{2,19}$/.test(u);let myUsername='',authVersion=0,searchVersion=0;const normalize=u=>String(u||'').trim().replace(/^@/,'').toLowerCase();
const status=t=>$('status').textContent=t;const feedback=t=>$('authFeedback').textContent=t;
function clean(s){return String(s||'').trim()};function initials(s){return clean(s).slice(0,1).toUpperCase()||'?'};
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function pair(a,b){return [a,b].sort().join('_')}
$('googleLogin').onclick=async()=>{feedback('Opening Google sign-in…');try{await signInWithPopup(auth,provider)}catch(e){if(e.code==='auth/popup-blocked'){try{await signInWithRedirect(auth,provider);return}catch(x){feedback(x.message);return}}feedback(e.message)}};
getRedirectResult(auth).catch(e=>feedback(e.message));
$('logoutBtn').onclick=()=>signOut(auth);
async function enterApp(){
  $('sideName').textContent='@'+myUsername;
  $('sideHandle').textContent='Your private username';
  $('sideAvatar').textContent=initials(myUsername);
  $('searchInput').value='';
  $('authPage').classList.add('hidden');$('usernamePage').classList.add('hidden');$('appShell').classList.remove('hidden');
  watchThreads();
}
$('usernameLogout').onclick=()=>signOut(auth);
$('usernameField').oninput=()=>{$('usernameField').value=normalize($('usernameField').value);$('usernameFeedback').textContent=''};
onAuthStateChanged(auth,async u=>{
  const version=++authVersion;
  if(stopMessages){stopMessages();stopMessages=null}
  if(stopThreads){stopThreads();stopThreads=null}
  ++searchVersion;users.clear();active=null;threads=[];me=u;myUsername='';
  $('appShell').classList.add('hidden');$('appShell').classList.remove('chat-open');
  $('chatView').classList.add('hidden');$('chatWelcome').classList.remove('hidden');
  if(!u){$('usernamePage').classList.add('hidden');$('authPage').classList.remove('hidden');return}
  $('authPage').classList.add('hidden');$('usernamePage').classList.remove('hidden');
  $('usernameForm').classList.add('hidden');$('usernameFeedback').textContent='Checking your account…';
  try{
    const profile=await getDoc(doc(db,'users',u.uid));if(version!==authVersion)return;
    const username=profile.exists()?profile.data().username:null;
    if(validUsername(username)){myUsername=username;users.set(u.uid,{uid:u.uid,username});enterApp();return}
    $('usernameForm').classList.remove('hidden');$('usernameFeedback').textContent='';
    const suggestion=normalize((u.email||'').split('@')[0]).replace(/[^a-z0-9_]/g,'').slice(0,20);
    $('usernameField').value=validUsername(suggestion)?suggestion:'';$('usernameField').focus();
  }catch(e){if(version===authVersion)$('usernameFeedback').textContent='Could not load account: '+e.message}
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
function watchThreads(){stopThreads=onSnapshot(query(collection(db,'threads'),where('members','array-contains',me.uid)),snap=>{threads=snap.docs.map(d=>({id:d.id,...d.data()}));if(!$('searchInput').value.trim())renderThreads()},e=>status('Could not load chats: '+e.message))}
function makePersonButton(u,click,preview='Start private chat'){const b=el('button','conversation');b.type='button';const a=el('div','avatar',initials(u.username));const body=el('div','conversation-body');body.append(el('strong',null,'@'+(u.username||'user')),el('small',null,preview));b.append(a,body);b.onclick=click;return b}
async function getUser(uid){if(users.has(uid))return users.get(uid);const snap=await getDoc(doc(db,'users',uid));const u=snap.exists()?{uid,username:snap.data().username||'user'}:{uid,username:'user'};users.set(uid,u);return u}
async function renderThreads(){const nav=$('conversationList');nav.replaceChildren();$('listTitle').textContent='Your conversations';$('allChatsBtn').classList.add('hidden');$('emptyList').textContent='No chats yet. Tap “New personal chat” to start.';$('emptyList').classList.toggle('hidden',threads.length>0);for(const t of threads){const other=t.members.find(id=>id!==me.uid);if(!other)continue;const u=await getUser(other);nav.append(makePersonButton(u,()=>openChat(t.id,u),'Private conversation'))}}
async function searchPeople(term){
  const version=++searchVersion,nav=$('conversationList');nav.replaceChildren();
  $('listTitle').textContent='Find people';$('allChatsBtn').classList.remove('hidden');$('emptyList').classList.add('hidden');
  const prefix=normalize(term);
  if(!prefix){nav.append(el('p','empty-list','Type an @username to find another user.'));return}
  if(!/^[a-z][a-z0-9_]{0,19}$/.test(prefix)){nav.append(el('p','empty-list','Use letters, numbers and underscores.'));return}
  try{
    const snap=await getDocs(query(collection(db,'handles'),orderBy(documentId()),startAt(prefix),endAt(prefix+'\uf8ff'),limit(25)));
    const matches=snap.docs.filter(d=>d.data().uid!==me?.uid);
    const found=await Promise.all(matches.map(async d=>{const u=await getUser(d.data().uid);return {...u,username:d.id}}));
    if(version!==searchVersion||!me)return;
    if(!found.length)nav.append(el('p','empty-list','No matching username found.'));
    for(const u of found)nav.append(makePersonButton(u,()=>startChat(u),'Tap to start a private chat'));
  }catch(e){if(version===searchVersion)nav.append(el('p','empty-list','Search failed: '+e.message))}
}
$('newChatBtn').onclick=$('mobileNewChat').onclick=()=>{$('searchInput').value='';searchPeople('');$('searchInput').focus()};$('allChatsBtn').onclick=()=>{$('searchInput').value='';renderThreads()};let searchTimer;$('searchInput').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{$('searchInput').value.trim()?searchPeople($('searchInput').value):renderThreads()},250)};
async function startChat(u){try{const id=pair(me.uid,u.uid);await setDoc(doc(db,'threads',id),{members:[me.uid,u.uid].sort(),updatedAt:serverTimestamp()},{merge:true});openChat(id,u)}catch(e){alert('Could not create chat: '+e.message)}}
function openChat(id,u){if(stopMessages)stopMessages();active={id,other:u};$('chatWelcome').classList.add('hidden');$('chatView').classList.remove('hidden');$('appShell').classList.add('chat-open');$('chatName').textContent='@'+(u.username||'user');$('chatAvatar').textContent=initials(u.username);$('messages').replaceChildren();status('Loading messages…');stopMessages=onSnapshot(query(collection(db,'threads',id,'messages'),orderBy('createdAt','desc'),limit(300)),snap=>{const container=$('messages');container.replaceChildren();const arr=snap.docs.slice().reverse();for(const item of arr){const m=item.data(),own=m.senderId===me.uid;const node=el('article','msg'+(own?' own':''));node.append(el('div','msg-body',m.text));const meta=el('div','msg-meta');const d=m.createdAt?.toDate?.();meta.append(el('span',null,d?d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'Sending…'));if(own){const del=el('button','delete-msg','🗑');del.title='Delete message';del.onclick=async()=>{if(confirm('Delete this message?'))try{await deleteDoc(doc(db,'threads',id,'messages',item.id))}catch(e){status(e.message)}};meta.append(del)}node.append(meta);container.append(node)}container.scrollTop=container.scrollHeight;status('Private chat • latest 300 messages')},e=>status('Could not load messages: '+e.message))}
$('backToChats').onclick=()=>{$('appShell').classList.remove('chat-open')};
$('messageForm').onsubmit=async e=>{e.preventDefault();if(!active||!me)return;const text=clean($('messageInput').value);if(!text)return;const id=active.id;$('sendBtn').disabled=true;status('Sending…');try{await addDoc(collection(db,'threads',id,'messages'),{senderId:me.uid,text,createdAt:serverTimestamp()});$('messageInput').value='';status('Sent')}catch(err){status('Send failed: '+err.message)}finally{$('sendBtn').disabled=false}};
