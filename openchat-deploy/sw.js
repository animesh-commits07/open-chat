self.addEventListener('push',event=>{
  let data={title:'OpenChat',body:'New private message',url:'/'};
  try{if(event.data)data={...data,...event.data.json()}}catch(e){}
  const title=typeof data.title==='string'?data.title:'OpenChat';
  const body=typeof data.body==='string'?data.body:'New private message';
  let url='/';
  try{const parsed=new URL(data.url||'/',self.location.origin);if(parsed.origin===self.location.origin)url=parsed.href}catch(e){}
  event.waitUntil(self.registration.showNotification(title,{
    body,tag:String(data.tag||''),icon:'/favicon.ico',
    data:{url}
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  let destination=self.location.origin+'/';
  try{const target=new URL(event.notification.data?.url||'/',self.location.origin);if(target.origin===self.location.origin)destination=target.href}catch(e){}
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
    for(const client of windows){
      if(client.url.startsWith(self.location.origin)){
        await client.navigate(destination);
        return client.focus();
      }
    }
    return clients.openWindow(destination);
  }));
});
