import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const base=process.env.TEST_URL||'http://127.0.0.1:3001';const password=(await readFile(new URL('../data/admin-access.txt',import.meta.url),'utf8')).match(/Пароль: (.+)/)[1];
async function call(path,method='GET',data,headers={}){return fetch(base+path,{method,headers:{'Content-Type':'application/json',Origin:base,...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});}
assert.equal((await call('/api/admin/content','PUT',{})).status,401);
assert.equal((await call('/data/auth.json')).status,404);assert.equal((await call('/data/content.sqlite')).status,404);
const login=await call('/api/admin/login','POST',{password});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/SameSite=Strict/);const cookie=login.headers.get('set-cookie').split(';')[0];const {csrf}=await login.json();const headers={Cookie:cookie,'X-CSRF-Token':csrf};
assert.equal((await call('/api/admin/content','PUT',{}, {Cookie:cookie})).status,403);
assert.equal((await call('/api/admin/content','PUT',{}, {...headers,Origin:'https://evil.example'})).status,403);
const original=await (await call('/api/content')).json();assert.ok(original.routes.length===4);const invalid=structuredClone(original);invalid.routes[0].price=-1;assert.equal((await call('/api/admin/content','PUT',invalid,headers)).status,400);
assert.equal((await call('/api/admin/upload','POST',{data:'data:image/svg+xml;base64,PHN2Zz4='},headers)).status,400);
const changed=structuredClone(original);changed.routes[0].price=original.routes[0].price+1;const save=await call('/api/admin/content','PUT',changed,headers);assert.equal(save.status,200);const saved=await save.json();assert.equal((await (await call('/api/content')).json()).routes[0].price,changed.routes[0].price);assert.equal((await call('/api/admin/content','PUT',original,headers)).status,400);original.revision=saved.revision;assert.equal((await call('/api/admin/content','PUT',original,headers)).status,200);
assert.equal((await call('/api/admin/logout','POST',{},headers)).status,200);assert.equal((await call('/api/admin/session','GET',undefined,headers)).status,401);
console.log('PASS: login, private files, CSRF/Origin, validation, upload rejection, persistence, revision conflicts, logout; original prices restored.');
