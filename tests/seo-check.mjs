import assert from 'node:assert/strict';
import {mkdtemp,copyFile,mkdir,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {parseHTML,DOMParser} from 'linkedom';
const root=await mkdtemp(join(tmpdir(),'po-puti-seo-'));let child;
try{
 for(const file of ['server.mjs','seo.mjs','admin-route.mjs','admin-api.mjs','content-store.mjs','booking-store.mjs','photo-background.mjs','photo-worker.mjs','initial-content.json'])await copyFile(resolve(file),join(root,file));
 await symlink(resolve('node_modules'),join(root,'node_modules'),'junction');await symlink(resolve('public'),join(root,'public'),'junction');await mkdir(join(root,'data'));
 const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 child=spawn(process.execPath,[join(root,'server.mjs')],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),METRICA_ID:'',GA4_ID:''},stdio:'pipe'});const base='http://127.0.0.1:'+port;
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
 const sitemap=await fetch(base+'/sitemap.xml');assert.equal(sitemap.status,200);const xml=new DOMParser().parseFromString(await sitemap.text(),'text/xml');const paths=[...xml.querySelectorAll('loc')].map(e=>new URL(e.textContent).pathname);assert.equal(paths.length,new Set(paths).size);assert.ok(paths.length>=10);
 assert.equal(xml.documentElement.localName,'urlset');
 assert.equal(xml.documentElement.getAttribute('xmlns'),'http://www.sitemaps.org/schemas/sitemap/0.9');
 const titles=new Set(),descriptions=new Set(),h1s=new Set();let links=0;
 for(const path of paths){const response=await fetch(base+path);assert.equal(response.status,200,path);const html=await response.text();assert.ok(!html.includes('perevozki-krasnoyarsk-shira.ru'),path);assert.ok(!html.includes('112152165'),path);const {document:d}=parseHTML(html);assert.equal(d.querySelectorAll('h1').length,1,path);const title=d.title,description=d.querySelector('meta[name=description]')?.getAttribute('content'),h1=d.querySelector('h1').textContent;assert.ok(title&&description&&h1,path);assert.ok(!titles.has(title));assert.ok(!descriptions.has(description));assert.ok(!h1s.has(h1));titles.add(title);descriptions.add(description);h1s.add(h1);assert.equal(d.querySelector('link[rel=canonical]').getAttribute('href'),'https://poputi-vmeste.ru'+path);assert.ok(!d.querySelector('meta[name=robots]')?.getAttribute('content').includes('noindex'));
  for(const property of ['og:title','og:description','og:image','og:url'])assert.ok(d.querySelector(`meta[property="${property}"]`),path);assert.ok(d.querySelector('meta[name="twitter:card"]'));for(const script of d.querySelectorAll('script[type="application/ld+json"]')){const schema=JSON.parse(script.textContent);assert.equal(schema['@context'],'https://schema.org');assert.ok(schema['@graph'].length);}
  for(const a of d.querySelectorAll('a[href]')){const href=a.getAttribute('href');if(href.startsWith('/')||href.startsWith('#')){const url=new URL(href,base+path);const result=await fetch(url);assert.equal(result.status,200,`${path} -> ${href}`);links++;}}
 }
 assert.equal((await fetch(base+'/missing-page')).status,404);assert.equal((await fetch(base+'/krasnoyarsk-shira.html',{redirect:'manual'})).status,301);assert.equal((await fetch(base+'/admin')).status,404);
 const robots=await (await fetch(base+'/robots.txt')).text();assert.ok(robots.includes('Sitemap: https://poputi-vmeste.ru/sitemap.xml'));assert.ok(!robots.includes('Disallow: /\n'));
 const config=await (await fetch(base+'/analytics-config.json')).json();assert.equal(config.metricaId,null);assert.equal(config.ga4Id,null);
 console.log(`PASS: ${paths.length} canonical SEO pages, ${links} internal links, SSR content, unique metadata/H1, JSON-LD, sitemap, robots, 301/404, disabled foreign analytics.`);
}finally{if(child){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}await rm(root,{recursive:true,force:true});}
