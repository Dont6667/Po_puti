import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {db} from './content-store.mjs';
import {changeBooking} from './booking-store.mjs';
import {adminPath} from './admin-route.mjs';
const secret=process.env.TELEGRAM_API_KEY||'';
const origin=(process.env.PUBLIC_ORIGIN||'https://poputi-vmeste.ru').replace(/\/$/,'');
const adminIds=new Set((process.env.TELEGRAM_ADMIN_IDS||'').split(',').map(x=>x.trim()).filter(Boolean));
const enabled=secret.length>=32&&adminIds.size>0;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function reply(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
function signature(id,expires){return createHmac('sha256',secret).update('telegram-call-v1:'+id+':'+expires).digest('hex');}
function equal(a,b){return timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());}
function booking(row){if(!row)return null;const expires=(Math.floor(Date.now()/86400000)+2)*86400;return {...JSON.parse(row.data),id:row.id,status:row.status,created_at:row.created_at,updated_at:row.updated_at,call_url:origin+`/tg-call/${row.id}/${expires}/${signature(row.id,expires)}`};}
const select='SELECT id,data,status,created_at,updated_at FROM bookings';
async function body(req){let data='';for await(const part of req){data+=part;if(Buffer.byteLength(data)>4096)throw Error('Слишком большой запрос');}return JSON.parse(data);}
export async function telegramApi(req,res,path){
 if(path.startsWith('/tg-call/')){
  const match=path.match(/^\/tg-call\/([a-f0-9-]{36})\/(\d{10})\/([a-f0-9]{64})$/);
  if(!enabled||!match||Number(match[2])<Date.now()/1000||!equal(match[3],signature(match[1],match[2]))||!['GET','HEAD'].includes(req.method)){reply(res,404,{error:'Ссылка недоступна или срок её действия истёк'});return true;}
  const row=db.prepare(select+' WHERE id=?').get(match[1]);if(!row){reply(res,404,{error:'Заявка не найдена'});return true;}
  const b=JSON.parse(row.data),digits=b.phone.replace(/\D/g,'');const phone=digits.length===11&&/^[78]/.test(digits)?'+7'+digits.slice(1):digits.length===10?'+7'+digits:'+'+digits;
  const nonce=randomBytes(16).toString('base64');
  const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Позвонить пассажиру — По пути</title><style>body{margin:0;min-height:100svh;display:grid;place-items:center;background:#f4faeb;color:#1e3f2d;font:18px/1.6 system-ui,sans-serif}main{margin:20px;max-width:420px;padding:32px;border-radius:24px;background:white;text-align:center;box-shadow:0 12px 50px #234a3512}small{letter-spacing:2px;font-weight:700;color:#5e793f}h1{font-size:26px;overflow-wrap:anywhere}a{display:block;background:#254c35;color:white;padding:16px 24px;border-radius:14px;text-decoration:none;font-weight:700}p{color:#52674d}</style><main><small>ПО ПУТИ · ПАССАЖИР</small><h1>${esc(b.name)}</h1><p>${esc(phone)}</p><a href="tel:${phone}">Позвонить ${esc(phone)}</a><p>Если набор номера не открылся автоматически, нажмите кнопку.</p></main><script nonce="${nonce}">window.location.href=${JSON.stringify('tel:'+phone)};</script></html>`;
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex,nofollow,noarchive','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`});res.end(req.method==='HEAD'?undefined:html);return true;
 }
 if(!path.startsWith('/api/internal/telegram/'))return false;
 if(!enabled){reply(res,404,{error:'Недоступно'});return true;}
 if(!equal(String(req.headers['x-telegram-key']||''),secret)){reply(res,401,{error:'Доступ запрещён'});return true;}
 try{
  if(req.method==='GET'&&path==='/api/internal/telegram/config'){reply(res,200,{ok:true,admin_url:origin+adminPath,server_time:new Date().toISOString()});return true;}
  if(req.method==='GET'&&path==='/api/internal/telegram/bookings'){
   const cursor=new URL(req.url,'http://localhost').searchParams.get('cursor');let after='',id='';
   if(cursor){const c=JSON.parse(Buffer.from(cursor,'base64url').toString());if(typeof c.created!=='string'||typeof c.id!=='string'||c.created.length>40||c.id.length>40)throw Error('Неверный курсор');after=c.created;id=c.id;}
   const requestedSince=new URL(req.url,'http://localhost').searchParams.get('since');
   if(requestedSince&&(requestedSince.length>40||!Number.isFinite(Date.parse(requestedSince))))throw Error('Неверное время');
   const since=requestedSince?new Date(requestedSince).toISOString():new Date(Date.now()-48*3600000).toISOString();
   const rows=db.prepare(select+' WHERE created_at>=? AND (created_at>? OR (created_at=? AND id>?)) ORDER BY created_at,id LIMIT 100').all(since,after,after,id);
   const last=rows.at(-1);reply(res,200,{bookings:rows.map(booking),cursor:rows.length===100?Buffer.from(JSON.stringify({created:last.created_at,id:last.id})).toString('base64url'):null});return true;
  }
  const match=path.match(/^\/api\/internal\/telegram\/bookings\/([a-f0-9-]{36})$/);
  if(match&&req.method==='GET'){const b=booking(db.prepare(select+' WHERE id=?').get(match[1]));reply(res,b?200:404,b||{error:'Заявка не найдена'});return true;}
  if(match&&req.method==='POST'){
   const data=await body(req);if(!adminIds.has(String(data.admin_id))){reply(res,403,{error:'Нет доступа'});return true;}
   changeBooking(match[1],data.action);console.log(JSON.stringify({event:'telegram_booking_action',booking_id:match[1],admin_id:String(data.admin_id),action:data.action}));
   reply(res,200,booking(db.prepare(select+' WHERE id=?').get(match[1])));return true;
  }
  reply(res,404,{error:'Не найдено'});return true;
 }catch(error){reply(res,400,{error:error.message||'Не удалось выполнить действие'});return true;}
}
