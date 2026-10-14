import assert from 'node:assert/strict';
import {mkdtemp,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=await mkdtemp(join(tmpdir(),'pp-deferred-'));
try{
 for(const name of ['content-store.mjs','booking-store.mjs'])await copyFile(new URL('../'+name,import.meta.url),join(root,name));
 const {db}=await import(pathToFileURL(join(root,'content-store.mjs')));
 const {changeBooking,purgeDeferredBookings}=await import(pathToFileURL(join(root,'booking-store.mjs')));
 const now=Date.now(),old=new Date(now-86400001).toISOString(),fresh=new Date(now).toISOString();
 const insert=(id,status,updated)=>db.prepare('INSERT INTO bookings VALUES(?,?,?,?,?,?)').run(id,id,'{}',status,fresh,updated);
 insert('expired','deferred',old);insert('fresh','deferred',fresh);insert('cancelled','cancelled',old);
 db.prepare('INSERT INTO booking_audit(booking_id,action,created_at) VALUES(?,?,?)').run('expired','defer',old);
 db.prepare('INSERT INTO confirmed_seats VALUES(?,?,?,?,?)').run('shira','2027-01-01','08:00',1,'expired');
 assert.equal(purgeDeferredBookings(now),1);
 assert.equal(db.prepare("SELECT * FROM bookings WHERE id='expired'").get(),undefined);
 assert.equal(db.prepare("SELECT * FROM booking_audit WHERE booking_id='expired'").get(),undefined);
 assert.equal(db.prepare("SELECT * FROM confirmed_seats WHERE booking_id='expired'").get(),undefined);
 assert.ok(db.prepare("SELECT * FROM bookings WHERE id='cancelled'").get());
 changeBooking('fresh','reject');assert.equal(purgeDeferredBookings(now+2*86400000),0);
 insert('pending','pending',fresh);changeBooking('pending','defer');
 const timer=db.prepare("SELECT updated_at FROM bookings WHERE id='pending'").get().updated_at;
 changeBooking('pending','defer');assert.equal(db.prepare("SELECT updated_at FROM bookings WHERE id='pending'").get().updated_at,timer);
 assert.equal(purgeDeferredBookings(Date.parse(timer)+86400000-1),0);
 assert.equal(purgeDeferredBookings(Date.parse(timer)+86400000),1);
 db.close();console.log('PASS: deferred TTL boundary, persistent deadline, audit/seat deletion, status change cancels TTL, repeated defer does not reset timer.');
}finally{await rm(root,{recursive:true,force:true});}
