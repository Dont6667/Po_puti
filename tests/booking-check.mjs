import assert from 'node:assert/strict';
import {mkdtemp,copyFile,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {randomBytes,scryptSync,createHmac} from 'node:crypto';
const telegramKey=randomBytes(32).toString('hex');
const root=await mkdtemp(join(tmpdir(),'po-puti-test-'));
let child;
try{
 for(const name of ['server.mjs','traffic-guard.mjs','telegram-integration.mjs','seo.mjs','performance.mjs','content-store.mjs','admin-api.mjs','booking-store.mjs','photo-background.mjs','photo-worker.mjs','admin-route.mjs'])await copyFile(new URL('../'+name,import.meta.url),join(root,name));
 await symlink(resolve('node_modules'),join(root,'node_modules'),'junction');
 await mkdir(join(root,'data'));await mkdir(join(root,'public'));
 await writeFile(join(root,'public','index.html'),'<html>test</html>');
 const password=randomBytes(20).toString('hex'),salt=randomBytes(16).toString('hex');
 await writeFile(join(root,'data','auth.json'),JSON.stringify({salt,hash:scryptSync(password,salt,64).toString('hex')}));
 await writeFile(join(root,'data','admin-access.txt'),'Адрес кабинета: http://127.0.0.1:3001/manage-obsolete\nПароль: '+password+'\n');
 const portServer=createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const port=portServer.address().port;await new Promise(r=>portServer.close(r));
 const base=`http://127.0.0.1:${port}`;
 async function start(){child=spawn(process.execPath,[join(root,'server.mjs')],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',PUBLIC_ORIGIN:'https://poputi-vmeste.ru',TELEGRAM_API_KEY:telegramKey,TELEGRAM_ADMIN_IDS:'6056397902,5673533667'},stdio:'pipe'});for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}if(child.exitCode!==null)throw Error('Test server failed');await new Promise(r=>setTimeout(r,50));}throw Error('Test server timeout');}
 async function stop(){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;child=null;}
 async function call(path,method='GET',data,headers={}){return fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:base,...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});}
 const json=async(path)=>{const r=await call(path);assert.equal(r.status,200);return r.json();};
 await start();
 const privateAdminPath=(await readFile(join(root,'data','admin-route.txt'),'utf8')).trim();
 const telegramHeaders={'X-Telegram-Key':telegramKey};
 assert.equal((await call('/api/internal/telegram/bookings')).status,401);
 assert.equal((await call('/api/internal/telegram/bookings','GET',undefined,{'X-Telegram-Key':'wrong'})).status,401);
 const config=await (await call('/api/internal/telegram/config','GET',undefined,telegramHeaders)).json();assert.equal(config.admin_url,'https://poputi-vmeste.ru'+privateAdminPath);
 assert.ok(privateAdminPath.startsWith('/manage-'));
 const access=await readFile(join(root,'data','admin-access.txt'),'utf8');
 assert.equal(access.split('\n')[0],'Адрес кабинета: https://poputi-vmeste.ru'+privateAdminPath);
 assert.ok(access.includes('Пароль: '+password));
 assert.equal((await fetch(base+'/admin')).status,404);assert.equal((await fetch(base+'/admin.html')).status,404);
 for(const privateFile of ['/data/auth.json','/data/content.sqlite','/data/admin-access.txt','/data/admin-route.txt'])assert.equal((await fetch(base+privateFile)).status,404);
 assert.equal((await fetch(base+'/')).headers.get('x-frame-options'),'DENY');
 assert.equal((await call('/api/admin/bookings')).status,401);
 for(const path of ['/data/auth.json','/data/content.sqlite','/data/admin-access.txt'])assert.equal((await call(path)).status,404);
 const login=await call('/api/admin/login','POST',{password});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
 const {csrf}=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0],headers={Cookie:cookie,'X-CSRF-Token':csrf};
 const original=await json('/api/content');assert.equal(original.drivers.length,3);const changed=structuredClone(original);changed.contacts.phone='+7 999 123-45-67';changed.contacts.telegram='';changed.routes[0].capacity=8;
 const photo=await readFile(new URL('../public/assets/po-puti-logo.png',import.meta.url));const uploaded=await call('/api/admin/upload','POST',{data:'data:image/png;base64,'+photo.toString('base64')},headers);assert.equal(uploaded.status,200);const uploadedPath=(await uploaded.json()).path;
 assert.ok(original.routes.every(route=>route.price===2200&&!route.priceFrom));
 assert.equal(original.images.comfortCar,'/assets/comfort-alphard-white.png');
 assert.equal(original.fleet[0].name,'Toyota Alphard');
 changed.routes[0].price=2400; // A later admin price must survive restarts.
 const carPhoto=await readFile(new URL('../public/assets/vellfire-russian.jpg',import.meta.url));
 const cutoutResponse=await call('/api/admin/upload','POST',{data:'data:image/jpeg;base64,'+carPhoto.toString('base64'),removeBackground:'car'},headers);assert.equal(cutoutResponse.status,200);
 const cutoutPath=(await cutoutResponse.json()).path;assert.ok(cutoutPath.endsWith('.png'));
 const cutoutImage=Buffer.from(await (await call(cutoutPath)).arrayBuffer());
 const sharp=(await import('sharp')).default;const raw=await sharp(cutoutImage).ensureAlpha().raw().toBuffer();let transparentPixels=0;for(let i=3;i<raw.length;i+=4)if(raw[i]<20)transparentPixels++;assert.ok(transparentPixels>raw.length/40,'background removed');
 assert.equal((await call('/api/admin/upload','POST',{data:'data:image/jpeg;base64,'+carPhoto.toString('base64'),removeBackground:'bad'},headers)).status,400);
 changed.drivers[0].name='Тестовый водитель';changed.drivers[0].experience=18;changed.drivers[0].image=uploadedPath;changed.images.salon=uploadedPath;changed.images.logo=uploadedPath;
 const saved=await call('/api/admin/content','PUT',changed,headers);assert.equal(saved.status,200);const current=await saved.json();assert.equal((await json('/api/content')).contacts.phone,changed.contacts.phone);assert.equal(current.routes[0].capacity,8);
 assert.equal(current.drivers[0].name,'Тестовый водитель');assert.equal(current.drivers[0].experience,18);assert.equal(current.images.salon,uploadedPath);assert.equal((await call(uploadedPath)).headers.get('content-type'),'image/png');
 const badDriver=structuredClone(current);badDriver.drivers[0].experience=-1;assert.equal((await call('/api/admin/content','PUT',badDriver,headers)).status,400);
 assert.equal((await call('/api/admin/content','PUT',changed,headers)).status,400);
 const invalid=structuredClone(current);invalid.routes[0].capacity=0;assert.equal((await call('/api/admin/content','PUT',invalid,headers)).status,400);
 invalid.routes[0].capacity=7;invalid.contacts.telegram='https://evil.example/';assert.equal((await call('/api/admin/content','PUT',invalid,headers)).status,400);
 const date=new Date(Date.now()+2*86400000).toISOString().slice(0,10),route=current.routes[0].id;
 const url=`/api/trips?route=${route}&date=${date}`,trips=await json(url);assert.equal(trips.trips[0].capacity,8);assert.deepEqual(trips.trips[0].occupied,[]);
 assert.equal((await call(`/api/trips?route=${route}&date=2026-02-31`)).status,400);
 assert.equal((await call(`/api/trips?route=missing&date=${date}`)).status,400);
 const data={token:randomBytes(20).toString('hex'),route,date,time:trips.trips[0].time,seats:[1,2],name:'Тестовый пассажир',phone:'+7 999 123-45-67',comment:'Багаж',consent:true};
 for(const name of ['12345','А','Антон123','<script>','Аааааа','Жопа','жОпА','фывфывфыв','фывыфывфыв','qwerty','asdfgh'])assert.equal((await call('/api/bookings','POST',{...data,name})).status,400);
 assert.equal((await call('/api/bookings','POST',data,{Origin:'https://evil.example'})).status,403);
 assert.equal((await call('/api/bookings','POST',{...data,consent:false})).status,400);
 assert.equal((await call('/api/bookings','POST',{...data,seats:[1,1]})).status,400);
 assert.equal((await call('/api/bookings','POST',{...data,seats:[9]})).status,400);
 const first=await call('/api/bookings','POST',data);assert.equal(first.status,201);const booking=await first.json();assert.deepEqual(Object.keys(booking).sort(),['id','status']);
 const telegramPath='/api/internal/telegram/bookings/'+booking.id;
 const telegramSnapshot=await (await call('/api/internal/telegram/bookings','GET',undefined,telegramHeaders)).json();assert.equal(telegramSnapshot.bookings[0].id,booking.id);
 const dialUrl=new URL(telegramSnapshot.bookings[0].call_url);assert.ok(!dialUrl.pathname.includes(data.phone));assert.ok(!dialUrl.pathname.includes(telegramKey));
 const dial=await call(dialUrl.pathname);assert.equal(dial.status,200);assert.equal(dial.headers.get('cache-control'),'no-store');assert.ok(dial.headers.get('x-robots-tag').includes('noindex'));assert.ok((await dial.text()).includes('tel:+79991234567'));
 assert.equal((await call(dialUrl.pathname.slice(0,-1)+(dialUrl.pathname.endsWith('a')?'b':'a'))).status,404);
 const expired=Math.floor(Date.now()/1000)-10;const signed=createHmac('sha256',telegramKey).update('telegram-call-v1:'+booking.id+':'+expired).digest('hex');assert.equal((await call(`/tg-call/${booking.id}/${expired}/${signed}`)).status,404);
 assert.equal((await call(telegramPath,'POST',{action:'confirm',admin_id:42},telegramHeaders)).status,403);
 const repeat=await call('/api/bookings','POST',data);assert.equal(repeat.status,201);assert.equal((await repeat.json()).id,booking.id);
 assert.equal((await call('/api/bookings','POST',{...data,name:'Другой пассажир'})).status,400);
 const conflict=await call('/api/bookings','POST',{...data,token:randomBytes(20).toString('hex')});assert.equal(conflict.status,201);const rival=await conflict.json();
 assert.equal((await call(telegramPath,'POST',{action:'confirm',admin_id:6056397902},telegramHeaders)).status,200);
 assert.deepEqual((await json(url)).trips[0].occupied,[1,2]);
 assert.equal((await call('/api/admin/bookings','POST',{id:booking.id,action:'confirm'},{Cookie:cookie})).status,403);
 const confirm={id:booking.id,action:'confirm'};assert.equal((await call('/api/admin/bookings','POST',confirm,headers)).status,200);
 assert.equal((await call('/api/admin/bookings','POST',confirm,headers)).status,200);
 assert.deepEqual((await json(url)).trips[0].occupied,[1,2]);
 const shrink=structuredClone(current);shrink.routes[0].capacity=1;assert.equal((await call('/api/admin/content','PUT',shrink,headers)).status,400);
 const removeTime=structuredClone(current);removeTime.routes[0].times='23:59';assert.equal((await call('/api/admin/content','PUT',removeTime,headers)).status,400);
 assert.equal((await call('/api/admin/bookings','POST',{id:rival.id,action:'confirm'},headers)).status,400);
 assert.equal((await call('/api/internal/telegram/bookings/'+rival.id,'POST',{action:'confirm',admin_id:5673533667},telegramHeaders)).status,400);
 assert.equal((await call('/api/bookings','POST',{...data,token:randomBytes(20).toString('hex')})).status,400);
 const list=await (await call('/api/admin/bookings','GET',undefined,headers)).json();assert.equal(list.bookings.length,2);assert.equal(list.bookings.find(b=>b.id===rival.id).status,'pending');
 await stop();await start();assert.deepEqual((await json(url)).trips[0].occupied,[1,2]);assert.equal((await json('/api/content')).contacts.phone,changed.contacts.phone);
 assert.equal((await json('/api/content')).routes[0].price,2400);
 assert.equal((await json('/api/content')).drivers[0].image,uploadedPath);assert.equal((await json('/api/content')).drivers[0].experience,18);
 assert.equal((await call('/api/admin/session','GET',undefined,headers)).status,401);
 const relogin=await call('/api/admin/login','POST',{password}),newCookie=relogin.headers.get('set-cookie').split(';')[0],newCsrf=(await relogin.json()).csrf,newHeaders={Cookie:newCookie,'X-CSRF-Token':newCsrf};
 assert.equal((await call('/api/admin/bookings','POST',{id:booking.id,action:'cancel'},newHeaders)).status,200);assert.deepEqual((await json(url)).trips[0].occupied,[]);
 assert.equal((await (await call(telegramPath,'GET',undefined,telegramHeaders)).json()).status,'cancelled');
 assert.equal((await call('/api/admin/bookings','POST',confirm,newHeaders)).status,400);
 assert.equal((await call('/api/admin/bookings','POST',{id:rival.id,action:'confirm'},newHeaders)).status,200);
 assert.equal((await call('/api/admin/bookings','POST',{id:rival.id,action:'reject'},newHeaders)).status,200);assert.deepEqual((await json(url)).trips[0].occupied,[]);
 assert.equal((await call('/api/admin/upload','POST',{data:'data:image/svg+xml;base64,PHN2Zz4='},newHeaders)).status,400);
 assert.equal((await call('/api/admin/logout','POST',{},newHeaders)).status,200);assert.equal((await call('/api/admin/bookings','GET',undefined,newHeaders)).status,401);
 console.log('PASS: contacts, route capacity, booking validation, idempotency, authorization, CSRF/Origin, seat conflict rollback, cancellation, SQLite persistence after restart, upload rejection.');
}finally{
 if(child){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}
 const target=resolve(root),parent=resolve(tmpdir())+sep;if(!target.startsWith(parent)||!target.slice(parent.length).startsWith('po-puti-test-'))throw Error('Unexpected test cleanup path');await rm(target,{recursive:true,force:true});
}




