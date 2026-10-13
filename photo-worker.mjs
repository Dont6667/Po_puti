import {parentPort,workerData} from 'node:worker_threads';
import sharp from 'sharp';
import {removeBackground} from '@imgly/background-removal-node';
try{
 const input=sharp(Buffer.from(workerData.bytes),{limitInputPixels:24000000}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true});
 const {data,info}=await input.clone().ensureAlpha().raw().toBuffer({resolveWithObject:true});
 let transparent=0;for(let i=3;i<data.length;i+=4)if(data[i]<240)transparent++;
 let png=await input.png().toBuffer();
 if(transparent/(info.width*info.height)<0.01){
  const result=await removeBackground(new Blob([png],{type:'image/png'}),{model:'medium',output:{format:'image/png',type:'foreground'}});
  png=Buffer.from(await result.arrayBuffer());
 }
 const output=await sharp(png).trim({background:'#00000000',threshold:15}).png().toBuffer();
 parentPort.postMessage({bytes:output});
}catch(error){parentPort.postMessage({error:true});}

