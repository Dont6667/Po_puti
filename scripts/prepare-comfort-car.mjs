import sharp from 'sharp';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const file='public/assets/image-manifest.json',manifest=JSON.parse(readFileSync(file,'utf8'));
const source=JSON.parse(readFileSync('initial-content.json','utf8')).images.comfortCar;
if(existsSync('public'+source)){
 const bytes=readFileSync('public'+source),info=await sharp(bytes).metadata();
 const hash=createHash('sha256').update(bytes).update('car-webp95-v1').digest('hex').slice(0,12),variants=[];
 for(const size of [480,960,1440]){
  const width=Math.min(size,info.width);if(variants.some(x=>x.width===width))continue;
  const url=`/assets/optimized/${hash}-${width}.webp`;
  if(!existsSync('public'+url))await sharp(bytes).resize({width,withoutEnlargement:true}).webp({quality:95,effort:6}).toFile('public'+url);
  variants.push({width,url});
 }
 manifest[source]={width:info.width,height:info.height,variants};writeFileSync(file,JSON.stringify(manifest));
}
