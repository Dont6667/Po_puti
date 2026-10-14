import {build} from 'esbuild';
import {transform} from 'lightningcss';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseHTML} from 'linkedom';
await import('./prepare-hero.mjs');
await import('./prepare-transfer.mjs');
const directory='public/assets/built';mkdirSync(directory,{recursive:true});
const hash=buffer=>createHash('sha256').update(buffer).digest('hex').slice(0,12);
const save=(name,extension,buffer)=>{const path=`/assets/built/${name}-${hash(buffer)}.${extension}`;writeFileSync('public'+path,buffer);return path;};
const fontSources=['/assets/fonts/golos-latin-cyrillic.woff2','/assets/fonts/unbounded-latin-cyrillic.woff2'];
const fontPaths=fontSources.map(path=>save(path.includes('/golos-')?'golos':'unbounded','woff2',readFileSync('public'+path)));
const {document}=parseHTML(readFileSync('public/index.html','utf8'));
const removed=[];
// Eight copied files are stored as gzip bytes, served without Content-Encoding,
// and have zero CSS rules in the browser. Do not enable these obsolete styles.
const sources=[...document.querySelectorAll('link[rel=stylesheet]')].map(x=>x.getAttribute('href').split('?')[0]);
const css=sources.map(path=>{const bytes=readFileSync('public'+path);if(path.includes('/assets/mirror/')){removed.push(path);return path.includes('8c6add94')?readFileSync('public/legacy-base.css','utf8'):'';}return bytes.toString('utf8');}).join('\n')+'\n'+readFileSync('public/performance.css','utf8');
const fonts=text=>text.replaceAll('/assets/fonts/golostext.ttf',fontPaths[0]).replaceAll('/assets/fonts/unbounded.ttf',fontPaths[1]);
const presentClasses=new Set([...document.querySelectorAll('[class]')].flatMap(x=>x.getAttribute('class').split(/\s+/)));
const runtime=['content.js','intro.js','booking.js','controls.js','analytics.js','images.js','journey.js'].map(x=>readFileSync('public/'+x,'utf8')).join('\n');
// Keep every runtime class, including dialogs, calendar states and animations.
// Only remove classes absent from both the HTML and all public runtime sources.
const unused=[...new Set([...css.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map(x=>x[1]))].filter(x=>!presentClasses.has(x)&&!runtime.includes(x));
const minify=(name,css)=>save(name,'css',transform({filename:name+'.css',code:Buffer.from(fonts(css)),minify:true,unusedSymbols:name==='home'?unused:[],targets:{chrome:100<<16,safari:15<<16,firefox:100<<16}}).code);
const homeCss=minify('home',css),readingCss=minify('reading',readFileSync('public/reading.css','utf8')+readFileSync('public/seo.css','utf8'));
const result=await build({stdin:{contents:['content.js','intro.js','booking.js','controls.js','analytics.js','images.js','journey.js'].map(x=>`import './${x}';`).join('\n'),resolveDir:process.cwd()+'/public'},bundle:true,minify:true,format:'iife',target:['es2020'],write:false,legalComments:'none'});
const homeJs=save('home','js',result.outputFiles[0].contents);
const analyticsJs=save('analytics','js',(await build({entryPoints:['public/analytics.js'],minify:true,write:false,target:'es2020'})).outputFiles[0].contents);
const manifest={homeCss,readingCss,homeJs,analyticsJs,fonts:fontPaths,removedStyles:removed};
for(const font of manifest.fonts)if(!existsSync('public'+font))throw Error('Missing prepared font: '+font);
writeFileSync(directory+'/manifest.json',JSON.stringify(manifest,null,2));
console.log(JSON.stringify({homeCssBytes:readFileSync('public'+homeCss).length,homeJsBytes:result.outputFiles[0].contents.length,removedStyles:removed.length},null,2));


