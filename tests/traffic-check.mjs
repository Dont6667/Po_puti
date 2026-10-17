import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {TrafficGuard,clientIp,ipGroup} from '../traffic-guard.mjs';
const req=(ip='198.51.100.1',url='/api/content',extra={})=>({socket:{remoteAddress:ip},url,method:'GET',headers:{},...extra});
const res=()=>Object.assign(new EventEmitter(),{status:0,writeHead(status,headers){this.status=status;this.headers=headers;},end(){this.emit('finish');}});
let now=10000;const guard=new TrafficGuard(()=>now);
for(let i=0;i<60;i++){const r=res();assert.equal(guard.accept(req(),r,'/api/content'),true);r.emit('finish');}
let r=res();assert.equal(guard.accept(req(),r,'/api/content'),false);assert.equal(r.status,429);assert.equal(r.headers['Retry-After'],'5');
r=res();assert.equal(guard.accept(req('198.51.100.2'),r,'/api/content'),true);r.emit('finish');
now+=1000;r=res();assert.equal(guard.accept(req(),r,'/api/content'),true);r.emit('finish');
assert.equal(clientIp(req('198.51.100.1','/',{headers:{'x-pp-client-ip':'203.0.113.2','x-forwarded-for':'9.9.9.9'}}),false),'198.51.100.1');
assert.equal(clientIp(req('172.18.0.3','/',{headers:{'x-pp-client-ip':'203.0.113.2'}}),true),'203.0.113.2');
assert.equal(clientIp(req('172.18.0.3','/',{headers:{'x-pp-client-ip':'203.0.113.2, 9.9.9.9'}}),true),'172.18.0.3');
assert.equal(ipGroup('2001:db8:abcd:1::1'),ipGroup('2001:0db8:abcd:0001:0:0:0:ffff'));
const active=new TrafficGuard(()=>now),held=[];
for(let i=0;i<24;i++){r=res();assert.ok(active.accept(req(),r,'/api/content'));held.push(r);}
r=res();assert.equal(active.accept(req(),r,'/api/content'),false);assert.equal(r.status,503);
held[0].emit('finish');held[0].emit('close');assert.equal(active.active,23);
r=res();assert.ok(active.accept(req(),r,'/api/content'));r.emit('close');
const sizes=new TrafficGuard(()=>now);
r=res();assert.equal(sizes.accept(req('1.1.1.1','/',{headers:{'content-length':'10001'}}),r,'/api/bookings'),false);assert.equal(r.status,413);
r=res();assert.ok(sizes.accept(req('1.1.1.1','/',{headers:{'content-length':'100001'}}),r,'/api/admin/content'));r.emit('finish');
const uploads=new TrafficGuard(()=>now),live=[];
for(let i=0;i<2;i++){r=res();assert.ok(uploads.accept(req('1.1.1.'+(i+1),'/',{method:'POST'}),r,'/api/admin/upload'));live.push(r);}
r=res();assert.equal(uploads.accept(req('1.1.1.3','/',{method:'POST'}),r,'/api/admin/upload'),false);assert.equal(r.status,503);
live[0].emit('close');assert.equal(uploads.uploads,1);
const capacity=new TrafficGuard(()=>now);for(let i=0;i<20000;i++)capacity.clients.set(String(i),{active:0,seen:now});
r=res();assert.equal(capacity.accept(req('8.8.8.8'),r,'/api/content'),false);assert.equal(capacity.clients.size,20000);
now+=300001;capacity.prune();assert.equal(capacity.clients.size,0);
assert.equal(guard.active,0);console.log('PASS: rate/refill, per-IP isolation, spoofed-header rejection, IPv6 /64, body limits, concurrency/release, upload cap, bounded tracking.');
