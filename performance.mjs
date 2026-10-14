import {readFileSync,existsSync} from 'node:fs';
const root=new URL('./public/',import.meta.url);
const file=new URL('assets/built/manifest.json',root);
const assets=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):null;
const sheets=new Map();
export function applyPageAssets(document){
 if(!assets)return;
 const home=!!document.querySelector('.pp-hero');
 const cssPath=home?assets.homeCss:assets.readingCss;
 if(!sheets.has(cssPath))sheets.set(cssPath,readFileSync(new URL(cssPath.slice(1),root),'utf8'));
 // Inline the complete minified public stylesheet: no blocking CSS request,
 // no late styles or flash on lower-page content, and no duplicate SEO styles.
 document.head.querySelectorAll('link[rel=stylesheet],style').forEach(x=>x.remove());
 const style=document.createElement('style');style.id='pp-public-styles';style.textContent=sheets.get(cssPath);document.head.append(style);
 for(const path of assets.fonts){const preload=document.createElement('link');preload.rel='preload';preload.setAttribute('as','font');preload.setAttribute('type','font/woff2');preload.setAttribute('crossorigin','anonymous');preload.href=path;document.head.prepend(preload);}
 if(home){
  document.querySelectorAll('script[src]').forEach(x=>x.remove());
  const script=document.createElement('script');script.src=assets.homeJs;script.defer=true;document.head.append(script);
 }else document.querySelectorAll('script[src="/analytics.js"]').forEach(x=>x.src=assets.analyticsJs);
}
