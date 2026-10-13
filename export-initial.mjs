import {readContent} from './content-store.mjs';
import {writeFileSync,copyFileSync,mkdirSync} from 'node:fs';
const c=readContent();delete c.revision;
mkdirSync('public/assets/initial',{recursive:true});
function walk(value){if(typeof value==='string'&&value.startsWith('/assets/uploads/')){const name=value.split('/').pop();copyFileSync('public'+value,'public/assets/initial/'+name);return '/assets/initial/'+name;}if(Array.isArray(value))return value.map(walk);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,walk(v)]));return value;}
writeFileSync('initial-content.json',JSON.stringify(walk(c),null,2));
