self.addEventListener("push",event=>{
  let data={title:"OpenChat",body:"New message",url:"/"};
  try{if(event.data)data={...data,...event.data.json()}}catch(e){}
  event.waitUntil(
    self.registration.showNotification(data.title||"OpenChat",{
      body:data.body||"New message",
      data:{url:data.url||"/"}
    })
  );
});

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||"/",self.location.origin).href;
  event.waitUntil(
    clients.matchAll({type:"window",includeUncontrolled:true}).then(async list=>{
      for(const client of list){
        if(client.url.startsWith(self.location.origin)){
          await client.navigate(target);
          return client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
