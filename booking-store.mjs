import {randomUUID} from 'node:crypto';
import {db,readContent} from './content-store.mjs';

db.exec(`CREATE TABLE IF NOT EXISTS bookings (
 id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, data TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS confirmed_seats (
 route TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL, seat INTEGER NOT NULL,
 booking_id TEXT NOT NULL, PRIMARY KEY(route,date,time,seat)
);
CREATE TABLE IF NOT EXISTS booking_audit (
 id INTEGER PRIMARY KEY, booking_id TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL
);`);
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Krasnoyarsk',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function routeAndDate(routeId,date){
 const route=readContent().routes.find(r=>r.id===routeId&&r.active);
 if(!route)throw Error('Маршрут недоступен. Выберите другой.');
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date<today()||Date.parse(date)>Date.now()+366*86400000)throw Error('Выберите дату в течение ближайшего года.');
 return route;
}
export function availableTrips(routeId,date){
 const r=routeAndDate(routeId,date);
 return {route:{id:r.id,from:r.from,to:r.to,price:r.price,priceFrom:r.priceFrom,duration:r.duration,capacity:r.capacity},date,trips:r.times.split(',').map(t=>t.trim()).filter(time=>Date.parse(`${date}T${time}:00+07:00`)>Date.now()).map(time=>({time,capacity:r.capacity,occupied:db.prepare('SELECT seat FROM confirmed_seats WHERE route=? AND date=? AND time=? ORDER BY seat').all(r.id,date,time).map(x=>x.seat)}))};
}
function text(x,max){if(typeof x!=='string'||x.trim().length>max||/[\u0000-\u001f]/.test(x))throw Error('Проверьте данные заявки.');return x.trim();}
export function createBooking(input){
 if(!input||typeof input.token!=='string'||!/^[a-zA-Z0-9-]{20,80}$/.test(input.token))throw Error('Обновите форму и повторите отправку.');
 const r=routeAndDate(input.route,input.date);
 const trip=availableTrips(r.id,input.date).trips.find(t=>t.time===input.time);
 if(!trip)throw Error('Рейс недоступен. Выберите другое время.');
 if(!Array.isArray(input.seats)||!input.seats.length||input.seats.length>r.capacity||new Set(input.seats).size!==input.seats.length||input.seats.some(s=>!Number.isInteger(s)||s<1||s>r.capacity))throw Error('Выберите корректные места.');
 const name=text(input.name,80),phone=text(input.phone,40),comment=text(input.comment||'',500);
 if(/([\p{L}]{2,4})\1{2,}/iu.test(name)||/^(?:фыв[фыва]*|йцу[йцукен]*|ячс[ячсмить]*|asdf[asdfghjkl]*|qwer[qwertyuiop]*|zxcv[zxcvbnm]*)$/iu.test(name)||/^(?:жопа|жопой|хуй|хуя|хер|пизда|блядь|блять|сука|мудак|долбоеб|говно|fuck|shit|asshole)$/iu.test(name.normalize('NFKC').replace(/ё/gi,'е'))||!/^[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)*$/u.test(name)||[...name.replace(/[^\p{L}]/gu,'')].length<2||/(\p{L})\1{3,}/iu.test(name))throw Error('Укажите настоящее имя буквами, без цифр и специальных символов.');
 if(!/^\+?[\d ()-]+$/.test(phone)||phone.replace(/\D/g,'').length<10||phone.replace(/\D/g,'').length>15||input.consent!==true)throw Error('Укажите имя, телефон и согласие на обработку данных.');
 const data={route:r.id,from:r.from,to:r.to,date:input.date,time:input.time,seats:[...input.seats].sort((a,b)=>a-b),name,phone,comment,price:r.price,priceFrom:r.priceFrom,consent:true};
 const previous=db.prepare('SELECT id,data FROM bookings WHERE token=?').get(input.token);
 if(previous){const old=JSON.parse(previous.data);for(const key of ['route','date','time','seats','name','phone','comment'])if(JSON.stringify(old[key])!==JSON.stringify(data[key]))throw Error('Эта форма уже отправлена. Начните новую заявку.');return {id:previous.id,status:'received'};}
 if(input.seats.some(s=>trip.occupied.includes(s)))throw Error('Место уже занято. Обновите список и выберите другое.');
 const id=randomUUID(),now=new Date().toISOString();
 db.prepare('INSERT INTO bookings(id,token,data,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,input.token,JSON.stringify(data),now,now);
 return {id,status:'received'};
}
export function listBookings(){return db.prepare('SELECT id,data,status,created_at,updated_at FROM bookings ORDER BY created_at DESC LIMIT 500').all().map(r=>({...r,...JSON.parse(r.data),data:undefined}));}
export function changeBooking(id,action){
 purgeDeferredBookings();
 if(!['confirm','cancel','reject','defer'].includes(action))throw Error('Неизвестное действие.');
 db.exec('BEGIN IMMEDIATE');
 try{
  const b=db.prepare('SELECT * FROM bookings WHERE id=?').get(id);if(!b)throw Error('Заявка не найдена.');
  const status={confirm:'confirmed',cancel:'cancelled',reject:'rejected',defer:'deferred'}[action];
  if(b.status===status){db.exec('COMMIT');return {status};}
  if(action==='confirm'){
   if(!['pending','deferred'].includes(b.status))throw Error('Закрытую заявку нельзя подтвердить.');
   const data=JSON.parse(b.data),trips=availableTrips(data.route,data.date),trip=trips.trips.find(t=>t.time===data.time);
   if(!trip||data.seats.some(s=>s>trip.capacity))throw Error('Рейс или схема мест изменились. Согласуйте поездку заново.');
   for(const seat of data.seats)db.prepare('INSERT INTO confirmed_seats VALUES(?,?,?,?,?)').run(data.route,data.date,data.time,seat,id);
  }else db.prepare('DELETE FROM confirmed_seats WHERE booking_id=?').run(id);
  const now=new Date().toISOString();db.prepare('UPDATE bookings SET status=?,updated_at=? WHERE id=?').run(status,now,id);
  db.prepare('INSERT INTO booking_audit(booking_id,action,created_at) VALUES(?,?,?)').run(id,action,now);
  db.exec('COMMIT');return {status};
 }catch(e){db.exec('ROLLBACK');if(e.message.includes('UNIQUE constraint'))throw Error('Одно из мест уже подтверждено другому пассажиру.');throw e;}
}

export function purgeDeferredBookings(now=Date.now()){
 const expired=db.prepare("SELECT id FROM bookings WHERE status='deferred' AND julianday(updated_at)<=julianday(?)").all(new Date(now-86400000).toISOString());
 if(!expired.length)return 0;
 db.exec('BEGIN IMMEDIATE');
 try{for(const {id} of expired){
  db.prepare('DELETE FROM confirmed_seats WHERE booking_id=?').run(id);
  db.prepare('DELETE FROM booking_audit WHERE booking_id=?').run(id);
  db.prepare('DELETE FROM bookings WHERE id=?').run(id);
 }db.exec('COMMIT');return expired.length;}catch(error){db.exec('ROLLBACK');throw error;}
}
purgeDeferredBookings();
setInterval(()=>{try{const count=purgeDeferredBookings();if(count)console.log(JSON.stringify({event:'deferred_bookings_deleted',count}));}catch{console.error(JSON.stringify({event:'deferred_cleanup_failed'}));}},5000).unref();
