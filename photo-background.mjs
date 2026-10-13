import {Worker} from 'node:worker_threads';
let busy=false;
export async function removePhotoBackground(bytes,type){
 if(busy)throw Error('Другая фотография уже обрабатывается. Повторите чуть позже.');
 busy=true;
 try{return await new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./photo-worker.mjs',import.meta.url),{workerData:{bytes,type}});
  let settled=false;
  const finish=(error,data)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();error?reject(error):resolve(Buffer.from(data));};
  const timer=setTimeout(()=>finish(Error('Обработка заняла слишком много времени. Попробуйте фотографию меньшего размера.')),120000);
  worker.once('message',result=>result.error?finish(Error('Не удалось удалить фон. Попробуйте другую фотографию.')):finish(null,result.bytes));
  worker.once('error',()=>finish(Error('Не удалось обработать фото. Проверьте установку зависимостей сайта.')));
  worker.once('exit',code=>{if(!settled)finish(Error('Обработка фотографии прервана.'));});
 });}finally{busy=false;}
}
