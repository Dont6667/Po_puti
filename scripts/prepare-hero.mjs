import sharp from 'sharp';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const file='public/assets/image-manifest.json';
const manifest=JSON.parse(readFileSync(file,'utf8'));
const source=JSON.parse(readFileSync('initial-content.json','utf8')).images.hero;
const item=manifest[source];
if(item){
 item.avif=[];
 for(const variant of item.variants){
  const url=variant.url.replace(/\.webp$/,'.avif');
  if(!existsSync('public'+url))await sharp('public'+source).rotate().resize({width:variant.width,withoutEnlargement:true}).avif({quality:65,effort:6}).toFile('public'+url);
  item.avif.push({width:variant.width,url});
 }
 writeFileSync(file,JSON.stringify(manifest));
}
