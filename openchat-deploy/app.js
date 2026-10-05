const SUPABASE_URL="https://wxsyxkzlrilsvhfgkupx.supabase.co";
const SUPABASE_KEY="sb_publishable_lkkAYoF80nQtoBlRv1g6OQ_Twqjm3Mq";
const db=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const messages=document.getElementById("messages"),form=document.getElementById("form"),input=document.getElementById("message"),statusEl=document.getElementById("status"),modal=document.getElementById("nameModal"),nameForm=document.getElementById("nameForm"),usernameInput=document.getElementById("username"),sideName=document.getElementById("sideName"),sideAvatar=document.getElementById("sideAvatar");
let username=localStorage.getItem("openchat_username")||"";
function setUser(n){username=n.trim().slice(0,30);localStorage.setItem("openchat_username",username);sideName.textContent=username;sideAvatar.textContent=(username[0]||"?").toUpperCase();modal.classList.add("hidden");loadMessages()}
if(username)setUser(username);
document.getElementById("changeName").onclick=()=>{usernameInput.value=username;modal.classList.remove("hidden");usernameInput.focus()};
nameForm.onsubmit=e=>{e.preventDefault();const n=usernameInput.value.trim();if(n)setUser(n)};
function esc(s){const d=document.createElement("div");d.textContent=s;return d.innerHTML}
async function loadMessages(){const {data,error}=await db.from("messages").select("id,username,message,created_at").order("created_at",{ascending:true}).limit(300);if(error){statusEl.textContent="Could not load messages.";return}messages.innerHTML=(data||[]).map(m=>`<article class="msg ${m.username===username?"own":""}"><div class="head">${esc(m.username)} · ${new Date(m.created_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div><div class="body">${esc(m.message)}</div></article>`).join("");messages.scrollTop=messages.scrollHeight;statusEl.textContent="Messages are saved for everyone."}
form.onsubmit=async e=>{e.preventDefault();if(!username){modal.classList.remove("hidden");return}const message=input.value.trim();if(!message)return;input.value="";statusEl.textContent="Sending…";const {error}=await db.from("messages").insert({username,message});if(error){statusEl.textContent="Message failed to send.";input.value=message;return}await loadMessages()};
loadMessages();setInterval(loadMessages,4000);
