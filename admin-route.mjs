import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
const directory=new URL('./data/',import.meta.url);await mkdir(directory,{recursive:true});
let route=process.env.ADMIN_PATH;
if(route&&!/^\/[a-zA-Z0-9_-]{12,80}$/.test(route))throw Error('ADMIN_PATH: / и 12–80 букв, цифр, дефисов или подчёркиваний');
if(!route){try{route=(await readFile(new URL('admin-route.txt',directory),'utf8')).trim();}catch{route='/manage-'+randomBytes(12).toString('hex');await writeFile(new URL('admin-route.txt',directory),route,{mode:0o600});}}
export const adminPath=route;
