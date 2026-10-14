// Scroll-driven journey is independent of the retired template renderer.
document.addEventListener('DOMContentLoaded',()=>{
 const scene=document.querySelector('.route-interlude'),path=scene?.querySelector('#scroll-route-path'),van=scene?.querySelector('#scroll-route-van');
 if(!scene||!path||!van)return;
 const landscape=scene.closest('.landscape-divider'),sun=landscape.querySelector('.landscape-moving-sun'),sky=landscape.querySelector('.landscape-sky');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');let visible=false,scheduled=false,length;
 const draw=()=>{
  scheduled=false;if(!visible)return;
  length??=path.getTotalLength();
  const r=scene.getBoundingClientRect();if(!r.width||!r.height)return;
  const progress=reduced.matches?.5:Math.max(.06,Math.min(.94,(innerHeight-r.top)/(innerHeight+r.height)));
  const distance=progress*length,point=path.getPointAtLength(distance),ahead=path.getPointAtLength(Math.min(length,distance+2));
  const scaleX=r.width/1100,scaleY=r.height/170;
  const angle=Math.atan2((ahead.y-point.y)*scaleY,(ahead.x-point.x)*scaleX)*180/Math.PI;
  van.style.left=point.x*scaleX+'px';van.style.top=point.y*scaleY+'px';van.style.transform=`translate(-50%,-50%) rotate(${angle}deg)`;van.style.visibility='visible';
  if(sun&&sky){const day=Math.sin(Math.PI*progress);sun.style.transform=`translate(${(.06+.88*progress)*landscape.clientWidth}px,${(.98-.68*day)*sky.clientHeight}px) translate(-50%,-50%)`;}
 };
 const schedule=()=>{if(visible&&!scheduled){scheduled=true;requestAnimationFrame(draw);}};
 if('IntersectionObserver' in window)new IntersectionObserver(entries=>{visible=entries.some(x=>x.isIntersecting);schedule();},{rootMargin:'100px'}).observe(landscape);
 else{visible=true;schedule();}
 addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule,{passive:true});reduced.addEventListener('change',schedule);
});
