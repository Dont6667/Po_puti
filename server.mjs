import {adminPath} from './admin-route.mjs';
import {api} from './admin-api.mjs';
import {publicSeo} from './seo.mjs';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const root=new URL('./public/',import.meta.url);
const types={html:'text/html; charset=utf-8',css:'text/css',js:'text/javascript',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',avif:'image/avif',svg:'image/svg+xml',gif:'image/gif',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',json:'application/json',xml:'application/xml',txt:'text/plain'};
const csp="default-src 'self'; img-src 'self' data: https://mc.yandex.ru https://mc.yandex.com; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://mc.yandex.ru https://mc.yandex.com https://www.googletagmanager.com; font-src 'self' data:; connect-src 'self' https://mc.yandex.ru https://mc.yandex.com https://*.google-analytics.com https://*.analytics.google.com; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
const headers={'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':csp};
const compressed=new Map();
function send(req,res,data,responseHeaders){
 const buffer=Buffer.isBuffer(data)?data:Buffer.from(data);
 const digest=createHash('sha256').update(buffer).digest('hex');
 const etag='W/"'+digest+'"';
 const compressible=/^(text\/|application\/(?:json|xml)|image\/svg)/.test(responseHeaders['Content-Type']);
 if(compressible)responseHeaders.Vary='Accept-Encoding';
 responseHeaders.ETag=etag;
 if(responseHeaders['Cache-Control']!=='no-store'&&req.headers['if-none-match']?.split(',').some(x=>x.trim()===etag)){res.writeHead(304,responseHeaders);res.end();return;}
 let body=buffer;
 const acceptsGzip=(req.headers['accept-encoding']||'').split(',').some(part=>{const [encoding,...parameters]=part.trim().split(';');const quality=parameters.find(x=>x.trim().startsWith('q='));return encoding==='gzip'&&(!quality||Number(quality.trim().slice(2))>0);});
 if(compressible&&buffer.length>1024&&acceptsGzip){
  if(!compressed.has(digest)){if(compressed.size>=100)compressed.delete(compressed.keys().next().value);compressed.set(digest,gzipSync(buffer,{level:6}));}
  body=compressed.get(digest);responseHeaders['Content-Encoding']='gzip';
 }
 responseHeaders['Content-Length']=body.length;
 res.writeHead(200,responseHeaders);res.end(req.method==='HEAD'?undefined:body);
}
createServer(async(req,res)=>{
 try{
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(await api(req,res,path))return;
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,headers);res.end();return;}
  if(path.includes('..')||path==='/admin'||path==='/admin.html')throw Error();
  if(path==='/index.html'||path.endsWith('.html')&&path!==adminPath&&path!=='/admin.html'){const canonical=path==='/index.html'?'/':path.slice(0,-5);if(publicSeo(canonical)){res.writeHead(301,{...headers,Location:canonical});res.end();return;}}
  if(path.length>1&&path.endsWith('/')){const canonical=path.slice(0,-1);if(publicSeo(canonical)){res.writeHead(301,{...headers,Location:canonical});res.end();return;}}
  if(path==='/analytics-config.json'){res.writeHead(200,{...headers,'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({metricaId:/^\d+$/.test(process.env.METRICA_ID||'')?Number(process.env.METRICA_ID):null,ga4Id:/^G-[A-Z0-9]+$/.test(process.env.GA4_ID||'')?process.env.GA4_ID:null}));return;}
  const seo=publicSeo(path);
  if(seo?.body){send(req,res,seo.body,{...headers,'Content-Type':seo.type,'Cache-Control':'no-store'});return;}
  if(/^\/(?:krasnoyarsk-shira|shira-krasnoyarsk|krasnoyarsk-minusinsk|krasnoyarsk-priiskovoe)(?:\.html)?$/.test(path)||path.startsWith('/marshruty/'))throw Error();
  const servedPath=path===adminPath?'/admin.html':(!path.split('/').pop().includes('.')?path+'.html':path);
  const url=new URL('.'+servedPath,root);if(!fileURLToPath(url).startsWith(fileURLToPath(root)))throw Error();
  const data=await readFile(url),isHtml=servedPath.endsWith('.html');
  const version=new URL(req.url,'http://localhost').searchParams.get('v');
  const immutable=/^\/assets\/(?:built|optimized)\/[^/]+-[a-f\d]{12}\./.test(servedPath)||/^\/assets\/optimized\/[a-f\d]{12}-\d+\./.test(servedPath)||version===createHash('sha256').update(data).digest('hex').slice(0,10);
  send(req,res,data,{...headers,'Content-Type':types[servedPath.split('.').pop()]||'application/octet-stream','Cache-Control':isHtml?'no-store':immutable?'public, max-age=31536000, immutable':'public, max-age=300, must-revalidate',...(isHtml?{'X-Robots-Tag':'noindex,follow'}:{})});
 }catch{res.writeHead(404,{...headers,'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end('Страница не найдена');}
}).listen(Number(process.env.PORT||3001),process.env.HOST||'127.0.0.1',()=>console.log('Website: http://'+(process.env.HOST||'127.0.0.1')+':'+(process.env.PORT||3001)));
