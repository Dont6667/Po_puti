import {adminPath} from './admin-route.mjs';
import {removePhotoBackground} from './photo-background.mjs';
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {readContent,saveContent} from './content-store.mjs';
import {availableTrips,createBooking,listBookings,changeBooking} from './booking-store.mjs';
const dir=new URL('./data/',import.meta.url);await mkdir(dir,{recursive:true,mode:0o700});
const publicOrigin=new URL(process.env.PUBLIC_ORIGIN||(process.env.DOMAIN?'https://'+process.env.DOMAIN:'http://127.0.0.1:'+(process.env.PORT||3001)));
if(!['http:','https:'].includes(publicOrigin.protocol)||publicOrigin.username||publicOrigin.password||publicOrigin.pathname!=='/'||publicOrigin.search||publicOrigin.hash)throw Error('PUBLIC_ORIGIN: укажите адрес сайта без пути, например https://poputi-vmeste.ru');
const adminUrl=publicOrigin.origin+adminPath;
let credentials;try{credentials=JSON.parse(await readFile(new URL('auth.json',dir),'utf8'));}catch{const password=randomBytes(18).toString('base64url');const salt=randomBytes(16).toString('hex');credentials={salt,hash:scryptSync(password,salt,64).toString('hex')};await writeFile(new URL('auth.json',dir),JSON.stringify(credentials),{mode:0o600});await writeFile(new URL('admin-access.txt',dir),'Адрес кабинета: '+adminUrl+'\nПароль: '+password+'\nПароль можно изменить в кабинете.\n',{mode:0o600});}
try{const access=new URL('admin-access.txt',dir);const text=await readFile(access,'utf8');await writeFile(access,text.replace(/^Адрес кабинета:[^\r\n]*/m,'Адрес кабинета: '+adminUrl),{mode:0o600});}catch{};
const sessions=new Map(),attempts=new Map(),bookingAttempts=new Map();
const cleanup=setInterval(()=>{const now=Date.now();for(const map of [attempts,bookingAttempts])for(const [key,value] of map)if(value.until<now)map.delete(key);for(const [key,value] of sessions)if(value.expires<now)sessions.delete(key);},60000);cleanup.unref();
export function json(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data));}
async function body(req,max=8000000){if(!req.headers['content-type']?.startsWith('application/json'))throw Error('Требуется JSON');let length=0;const chunks=[];for await(const chunk of req){length+=chunk.length;if(length>max)throw Error('Файл слишком большой');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString());}
function passwordMatches(password){if(typeof password!=='string'||password.length>256)return false;return timingSafeEqual(scryptSync(password,credentials.salt,64),Buffer.from(credentials.hash,'hex'));}
function session(req){const token=req.headers.cookie?.match(/(?:^|;\s*)pp_admin=([a-f0-9]{64})(?:;|$)/)?.[1];const s=sessions.get(token);if(!s||s.expires<Date.now()){sessions.delete(token);return null;}return {token,...s};}
const cookie=(token,age)=>`pp_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${process.env.COOKIE_SECURE==='1'?'; Secure':''}`;
export async function api(req,res,path){if(!path.startsWith('/api/'))return false;
 try{
 if(req.method==='GET'&&path==='/api/content'){json(res,200,readContent());return true;}
 if(req.method==='GET'&&path==='/api/health'){json(res,200,{ok:true});return true;}
 if(req.method==='GET'&&path==='/api/trips'){const query=new URL(req.url,'http://localhost').searchParams;json(res,200,availableTrips(query.get('route'),query.get('date')));return true;}
 if(req.method!=='GET'){if(req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`){json(res,403,{error:'Запрос разрешён только с этого сайта'});return true;}}
 if(req.method==='POST'&&path==='/api/admin/login'){const key=req.socket.remoteAddress;let a=attempts.get(key);if(!a||a.until<Date.now()){a={n:0,until:Date.now()+15*60000};attempts.set(key,a);}if(a.n>=8){json(res,429,{error:'Слишком много попыток. Повторите через 15 минут.'});return true;}const data=await body(req,4096);if(!passwordMatches(data.password)){a.n++;json(res,401,{error:'Неверный пароль'});return true;}attempts.delete(key);const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');sessions.set(token,{csrf,expires:Date.now()+8*3600000});json(res,200,{csrf},{'Set-Cookie':cookie(token,8*3600)});return true;}
 if(req.method==='POST'&&path==='/api/bookings'){const key=req.socket.remoteAddress;let a=bookingAttempts.get(key);if(!a||a.until<Date.now()){a={n:0,until:Date.now()+15*60000};bookingAttempts.set(key,a);}if(a.n>=20){json(res,429,{error:'Слишком много заявок. Повторите через 15 минут.'});return true;}a.n++;json(res,201,createBooking(await body(req,10000)));return true;}
 const s=session(req);if(!s){json(res,401,{error:'Войдите в кабинет'});return true;}
 if(req.method==='GET'&&path==='/api/admin/session'){json(res,200,{csrf:s.csrf});return true;}
 if(req.method==='GET'&&path==='/api/admin/bookings'){json(res,200,{bookings:listBookings()});return true;}
 if(req.headers['x-csrf-token']!==s.csrf){json(res,403,{error:'Обновите страницу кабинета'});return true;}
 if(req.method==='POST'&&path==='/api/admin/logout'){sessions.delete(s.token);json(res,200,{ok:true},{'Set-Cookie':cookie('',0)});return true;}
 if(req.method==='PUT'&&path==='/api/admin/content'){json(res,200,saveContent(await body(req,150000)));return true;}
 if(req.method==='POST'&&path==='/api/admin/bookings'){const data=await body(req,4096);json(res,200,changeBooking(data.id,data.action));return true;}
 if(req.method==='POST'&&path==='/api/admin/upload'){const {data,removeBackground:cutout}=await body(req);if(cutout!==undefined&&cutout!==false&&!['car','driver'].includes(cutout))throw Error('Некорректный тип фотографии');if(typeof data!=='string'||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data))throw Error('Разрешены JPG, PNG и WebP');let bytes=Buffer.from(data.split(',')[1],'base64');if(bytes.length>5*1024*1024)throw Error('Максимум 5 МБ');let ext;if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)ext='jpg';else if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))ext='png';else if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')ext='webp';else throw Error('Некорректное изображение');if(cutout){bytes=await removePhotoBackground(bytes,cutout);ext='png';if(bytes.length>5*1024*1024)throw Error('Обработанная фотография слишком большая');}const filename=randomBytes(16).toString('hex')+'.'+ext;const target=new URL('./public/assets/uploads/',import.meta.url);await mkdir(target,{recursive:true});await writeFile(new URL(filename,target),bytes,{flag:'wx'});json(res,200,{path:'/assets/uploads/'+filename});return true;}
 if(req.method==='POST'&&path==='/api/admin/password'){const data=await body(req,4096);if(!passwordMatches(data.current))throw Error('Неверный текущий пароль');if(typeof data.password!=='string'||data.password.length<12||data.password.length>128)throw Error('Пароль должен содержать от 12 до 128 символов');credentials={salt:randomBytes(16).toString('hex')};credentials.hash=scryptSync(data.password,credentials.salt,64).toString('hex');await writeFile(new URL('auth.json',dir),JSON.stringify(credentials),{mode:0o600});await writeFile(new URL('admin-access.txt',dir),'Адрес кабинета: '+adminUrl+'\nПароль изменён в кабинете.\n',{mode:0o600});sessions.clear();json(res,200,{ok:true},{'Set-Cookie':cookie('',0)});return true;}
 json(res,404,{error:'Не найдено'});
 }catch(e){json(res,400,{error:e.message||'Не удалось выполнить запрос'});}return true;
}


