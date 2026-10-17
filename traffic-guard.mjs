import {isIP} from 'node:net';
// Production website has no published port. Only Caddy overwrites this header.
export function clientIp(req,trustProxy=process.env.TRUST_CADDY==='1'){
 const direct=(req.socket.remoteAddress||'unknown').replace(/^::ffff:/,'');
 const forwarded=req.headers['x-pp-client-ip'];
 return trustProxy&&typeof forwarded==='string'&&isIP(forwarded)?forwarded.replace(/^::ffff:/,''):direct;
}
export function ipGroup(ip){
 if(isIP(ip)!==6)return ip;
 const [left,right='']=ip.toLowerCase().split('::');
 const a=left?left.split(':'):[],b=right?right.split(':'):[];
 const words=ip.includes('::')?[...a,...Array(8-a.length-b.length).fill('0'),...b]:a;
 return words.slice(0,4).map(x=>parseInt(x,16).toString(16)).join(':')+'::/64';
}
export class TrafficGuard{
 constructor(clock=Date.now){this.clock=clock;this.clients=new Map();this.global={tokens:600,last:clock()};this.active=0;this.uploads=0;this.rejections={};}
 bucket(bucket,burst,rate){const now=this.clock();bucket.tokens=Math.min(burst,bucket.tokens+(now-bucket.last)*rate/1000);bucket.last=now;if(bucket.tokens<1)return false;bucket.tokens--;return true;}
 prune(){const cutoff=this.clock()-300000;for(const [ip,s] of this.clients)if(!s.active&&s.seen<cutoff)this.clients.delete(ip);}
 reject(res,status,reason,delay=5){this.rejections[reason]=(this.rejections[reason]||0)+1;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Retry-After':String(delay),'Connection':'close'});res.end(JSON.stringify({error:status===413?'Слишком большой запрос':status===414?'Слишком длинный адрес':'Слишком много запросов. Повторите немного позже.'}));return false;}
 accept(req,res,path){
  if(req.url.length>4096)return this.reject(res,414,'url_size');
  const declared=req.headers['content-length'];
  const bodyLimit=path==='/api/admin/upload'?8000000:path==='/api/admin/content'?512000:10000;
  if(declared&&(Number(declared)>bodyLimit||!/^\d+$/.test(declared)))return this.reject(res,413,'body_size');
  if(path==='/api/health'&&(req.socket.remoteAddress==='127.0.0.1'||req.socket.remoteAddress==='::1'))return true;
  if(!this.bucket(this.global,600,120))return this.reject(res,503,'global_rate');
  const key=ipGroup(clientIp(req));let state=this.clients.get(key);
  if(!state){if(this.clients.size>=20000){this.prune();if(this.clients.size>=20000)return this.reject(res,503,'client_capacity');}
   state={seen:this.clock(),active:0,all:{tokens:180,last:this.clock()},api:{tokens:60,last:this.clock()},page:{tokens:30,last:this.clock()}};this.clients.set(key,state);}
  state.seen=this.clock();
  if(!this.bucket(state.all,180,30))return this.reject(res,429,'client_rate');
  if(path.startsWith('/api/')&&!this.bucket(state.api,60,8))return this.reject(res,429,'api_rate');
  const page=!path.startsWith('/assets/')&&!path.startsWith('/api/')&&!/\.(?:js|css|woff2?|png|jpg|svg|ico|webp|avif)$/.test(path);
  if(page&&!this.bucket(state.page,30,2))return this.reject(res,429,'page_rate');
  const upload=path==='/api/admin/upload'&&req.method==='POST';
  if(this.active>=128||state.active>=24||(upload&&this.uploads>=2))return this.reject(res,503,'concurrency');
  this.active++;state.active++;if(upload)this.uploads++;
  let released=false;const release=()=>{if(released)return;released=true;this.active--;state.active--;if(upload)this.uploads--;};
  res.once('finish',release);res.once('close',release);return true;
 }
 report(){this.prune();if(Object.keys(this.rejections).length){console.log(JSON.stringify({event:'traffic_guard',blocked:this.rejections,active:this.active,tracked:this.clients.size}));this.rejections={};}}
}
