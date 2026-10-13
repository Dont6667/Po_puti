(()=>{
 const started=performance.now();let finished=false;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const loader=document.querySelector('.pp-intro');if(!loader)return;
 const content=loader.querySelector('.pp-intro-content'),logo=content.querySelector('img');logo.className='pp-intro-logo';logo.src='/assets/po-puti-logo-crisp.svg';
 history.scrollRestoration='manual';if(location.hash)history.replaceState(null,'',location.pathname+location.search);window.scrollTo({top:0,left:0,behavior:'instant'});
 const stage=document.createElement('div');stage.className='pp-intro-stage';logo.before(stage);stage.append(logo);
 const car=document.createElement('span');car.className='pp-intro-car';car.setAttribute('aria-hidden','true');stage.append(car);
 async function dismiss(){
  if(finished)return;finished=true;
  window.scrollTo({top:0,left:0,behavior:'instant'});
  const target=document.querySelector('.pp-header .pp-brand img');
  try{
   if(!reduced&&target&&scrollY<100){
    const from=stage.getBoundingClientRect(),to=target.getBoundingClientRect();
    target.style.visibility='hidden';content.querySelector('strong').style.opacity='0';content.querySelector('p').style.opacity='0';
    loader.style.background='transparent';
    await stage.animate([{transform:'translate(0,0) scale(1)'},{transform:`translate(${to.left-from.left}px,${to.top-from.top}px) scale(${to.width/from.width},${to.height/from.height})`}],{duration:750,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'}).finished;
   }
  }finally{if(target){if(target.src.endsWith('/po-puti-logo-crisp.svg'))target.src='/assets/po-puti-logo-arrived.svg';target.style.visibility='';}loader.classList.add('pp-intro-done');document.documentElement.classList.add('pp-hero-ready');history.scrollRestoration='auto';setTimeout(()=>loader.remove(),450);}
 }
 const ready=()=>Promise.resolve(window.ppContentReady).catch(()=>{}).finally(()=>setTimeout(dismiss,reduced?0:Math.max(0,1800-(performance.now()-started))));
 if(document.readyState==='complete')ready();else window.addEventListener('load',ready,{once:true});
 setTimeout(dismiss,6000);
})();


