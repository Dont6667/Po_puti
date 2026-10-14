import sharp from 'sharp';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const file='public/assets/image-manifest.json',manifest=JSON.parse(readFileSync(file,'utf8'));
const source=JSON.parse(readFileSync('initial-content.json','utf8')).images.transferHero;
const item=manifest[source];
if(item){
 const bytes=readFileSync('public'+source),hash=createHash('sha256').update(bytes).update('transfer-webp-quality96-v1').digest('hex').slice(0,12);
 item.variants=[];
 for(const size of [640,1280,1760,item.width]){
  const width=Math.min(size,item.width);if(item.variants.some(x=>x.width===width))continue;
  const url=`/assets/optimized/${hash}-${width}.webp`;
  if(!existsSync('public'+url))await sharp(bytes).rotate().resize({width,withoutEnlargement:true}).webp({quality:96,smartSubsample:true,effort:6}).toFile('public'+url);
  item.variants.push({width,url});
 }
 writeFileSync(file,JSON.stringify(manifest));
}
