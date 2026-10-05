const SUPABASE_URL="https://wxsyxkzlrilsvhfgkupx.supabase.co";
const SUPABASE_KEY="sb_publishable_lkkAYoF80nQtoBlRv1g6OQ_Twqjm3Mq";
const db=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const messages=document.getElementById("messages"),form=document.getElementById("form"),input=document.getElementById("message"),statusEl=document.getElementById("status"),modal=document.getElementById("nameModal"),nameForm=document.getElementById("nameForm"),usernameInput=document.getElementById("username"),sideName=document.getElementById("sideName"),sideAvatar=document.getElementById("sideAvatar");

let username=localStorage.getItem("openchat_username")||"";
let ownerToken=localStorage.getItem("openchat_owner_token");
if(!ownerToken){ownerToken=crypto.randomUUID();localStorage.setItem("openchat_owner_token",ownerToken)}
let ownIds=new Set(JSON.parse(localStorage.getItem("openchat_own_message_ids")||"[]"));

function saveOwnIds(){localStorage.setItem("openchat_own_message_ids",JSON.stringify([...ownIds]))}
function setUser(n){username=n.trim().slice(0,30);localStorage.setItem("openchat_username",username);sideName.textContent=username;sideAvatar.textContent=(username[0]||"?").toUpperCase();modal.classList.add("hidden");loadMessages()}
if(username)setUser(username);

document.getElementById("changeName").onclick=()=>{usernameInput.value=username;modal.classList.remove("hidden");usernameInput.focus()};
nameForm.onsubmit=e=>{e.preventDefault();const n=usernameInput.value.trim();if(n)setUser(n)};
function esc(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML}

async function deleteMessage(id){
  if(!ownIds.has(id))return;
  if(!confirm("Delete this message for everyone?"))return;
  statusEl.textContent="Deleting…";
  const {data,error}=await db.rpc("delete_owned_message",{message_id:id,supplied_token:ownerToken});
  if(error||data!==true){statusEl.textContent="Could not delete this message.";return}
  ownIds.delete(id);saveOwnIds();await loadMessages();
}

async function loadMessages(){
  const {data,error}=await db.from("messages").select("id,username,message,created_at").order("created_at",{ascending:true}).limit(300);
  if(error){statusEl.textContent="Could not load messages.";return}
  messages.innerHTML=(data||[]).map(m=>{
    const own=ownIds.has(m.id);
    return `<article class="msg ${own?"own":""}">
      <div class="head">${esc(m.username)} · ${new Date(m.created_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
      ${own?`<button class="delete-msg" type="button" data-id="${m.id}" title="Delete message">🗑</button>`:""}</div>
      <div class="body">${esc(m.message)}</div>
    </article>`;
  }).join("");
  messages.querySelectorAll(".delete-msg").forEach(b=>b.onclick=()=>deleteMessage(Number(b.dataset.id)));
  messages.scrollTop=messages.scrollHeight;
  statusEl.textContent="Messages are saved for everyone.";
}

form.onsubmit=async e=>{
  e.preventDefault();
  if(!username){modal.classList.remove("hidden");return}
  const message=input.value.trim();
  if(!message)return;
  input.value="";statusEl.textContent="Sending…";
  const {data,error}=await db.from("messages").insert({username,message,owner_token:ownerToken}).select("id").single();
  if(error){statusEl.textContent="Message failed to send.";input.value=message;return}
  ownIds.add(data.id);saveOwnIds();await loadMessages();
};

loadMessages();
setInterval(loadMessages,4000);
