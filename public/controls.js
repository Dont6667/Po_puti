let ppSelectId=0;
function selectText(element,text){
 element.replaceChildren();const parts=text.split('→');if(parts.length===1){element.textContent=text;return;}
 const content=document.createElement('span');content.className='route-option-text';parts.forEach((part,index)=>{if(index){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M4 12h16m-6-6 6 6-6 6');svg.append(path);content.append(svg);}const label=document.createElement('span');label.textContent=part.trim();content.append(label);});element.append(content);
}
function enhanceSelects(root = document) {
  const instances = [];
  root.querySelectorAll('select').forEach(select => {
    if(select.dataset.enhanced)return;select.dataset.enhanced='true';if(!select.id)select.id='select-'+(++ppSelectId);
    const labelName = select.getAttribute('aria-label') || select.closest('label')?.firstChild.textContent.trim() || 'Выбор';
    const wrapper = document.createElement('div'); wrapper.className = 'custom-select'; select.after(wrapper); select.hidden = true;
    const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'select-trigger';
    trigger.setAttribute('role','combobox'); trigger.setAttribute('aria-haspopup','listbox'); trigger.setAttribute('aria-expanded','false');
    const list = document.createElement('div'); list.className = 'select-options'; list.id = select.id+'-options'; list.hidden = true;
    list.setAttribute('role','listbox'); list.setAttribute('aria-label',labelName); trigger.setAttribute('aria-controls',list.id);
    let options = []; let active = 0;
    const close = () => {list.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-activedescendant');wrapper.classList.remove('is-open');};
    const highlight = () => {options.forEach((button,index)=>button.classList.toggle('highlighted',index===active));trigger.setAttribute('aria-activedescendant',options[active].id);};
    function sync() {
      const selectedText=select.selectedOptions[0]?.textContent||labelName;selectText(trigger,selectedText);trigger.setAttribute('aria-label',`${labelName}: ${selectedText}`);
      list.replaceChildren();options=[...select.options].map((option,index)=>{
        const button=document.createElement('button');button.type='button';button.tabIndex=-1;button.className='select-option';selectText(button,option.textContent);button.setAttribute('aria-label',option.textContent);button.id=`${select.id}-option-${index}`;
        button.setAttribute('role','option');button.setAttribute('aria-selected',String(option.selected));button.disabled=option.disabled;
        button.addEventListener('mousedown',event=>event.preventDefault());
        button.addEventListener('click',()=>{select.value=option.value;close();select.dispatchEvent(new Event('change',{bubbles:true}));trigger.focus();});list.append(button);return button;
      });
    }
    function open(){instances.forEach(instance=>instance.close());sync();list.hidden=false;wrapper.classList.add('is-open');trigger.setAttribute('aria-expanded','true');active=select.selectedIndex;highlight();}
    trigger.addEventListener('click',()=>list.hidden?open():close());
    trigger.addEventListener('keydown',event=>{
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();if(list.hidden)open();else active=event.key==='Home'?0:event.key==='End'?options.length-1:(active+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;highlight();}
      else if(event.key==='Escape'){close();event.preventDefault();}
      else if((event.key==='Enter'||event.key===' ')&&!list.hidden){event.preventDefault();options[active].click();}
      else if(event.key==='Tab')close();
    });
    select.addEventListener('change',sync);new MutationObserver(sync).observe(select,{childList:true,subtree:true});wrapper.append(trigger,list);sync();instances.push({wrapper,close,sync});
  });
  document.addEventListener('click',event=>instances.forEach(instance=>{if(!event.composedPath().includes(instance.wrapper))instance.close();}));
  return {sync(){instances.forEach(instance=>{instance.close();instance.sync();});}};
}

function enhanceCalendar(input) {
  const parse=value=>{const[y,m,d]=value.split('-').map(Number);return new Date(y,m-1,d,12);};
  const iso=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const long=new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'});
  const monthFormat=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'});
  let month=parse(input.value);month.setDate(1);
  const wrapper=document.createElement('div');wrapper.className='date-picker';input.after(wrapper);input.hidden=true;
  const trigger=document.createElement('button');trigger.type='button';trigger.className='date-trigger';trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','travel-calendar');
  const panel=document.createElement('div');panel.id='travel-calendar';panel.className='travel-calendar';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Выберите дату поездки');
  const compact=new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'});
  const sync=()=>{trigger.replaceChildren(document.createTextNode(compact.format(parse(input.value))));const ns='http://www.w3.org/2000/svg',icon=document.createElementNS(ns,'svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');icon.classList.add('calendar-trigger-icon');for(const d of ['M8 2v4','M16 2v4','M3 10h18','M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01']){const path=document.createElementNS(ns,'path');path.setAttribute('d',d);icon.append(path);}const rect=document.createElementNS(ns,'rect');for(const[k,v]of Object.entries({x:3,y:4,width:18,height:18,rx:2}))rect.setAttribute(k,v);icon.prepend(rect);trigger.append(icon);trigger.setAttribute('aria-label',`Дата поездки: ${compact.format(parse(input.value))}, ${long.format(parse(input.value))}`);};
  const close=()=>{panel.hidden=true;trigger.setAttribute('aria-expanded','false');};
  const focusDate=value=>panel.querySelector(`[data-date="${value}"]`)?.focus();
  function render(){
    panel.replaceChildren();const head=document.createElement('div');head.className='calendar-head';
    const title=document.createElement('span');title.textContent=monthFormat.format(month);title.setAttribute('aria-live','polite');
    for(const[delta,label]of[[-1,'Предыдущий месяц'],[1,'Следующий месяц']]){const button=document.createElement('button');button.type='button';button.className='calendar-nav';button.textContent=delta<0?'‹':'›';button.setAttribute('aria-label',label);const target=new Date(month.getFullYear(),month.getMonth()+delta,1,12);const min=parse(input.min);min.setDate(1);const max=parse(input.max);max.setDate(1);button.disabled=target<min||target>max;button.addEventListener('click',()=>{month=target;render();panel.querySelector(`button[aria-label="${label}"]`)?.focus();});if(delta<0)head.append(button,title);else head.append(button);}
    panel.append(head);const weekdays=document.createElement('div');weekdays.className='calendar-weekdays';for(const day of['Пн','Вт','Ср','Чт','Пт','Сб','Вс']){const span=document.createElement('span');span.textContent=day;weekdays.append(span);}panel.append(weekdays);
    const grid=document.createElement('div');grid.className='calendar-grid';const offset=(month.getDay()+6)%7;const days=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
    for(let index=0;index<offset;index++)grid.append(document.createElement('span'));
    for(let day=1;day<=days;day++){
      const date=new Date(month.getFullYear(),month.getMonth(),day,12);const value=iso(date);const button=document.createElement('button');button.type='button';button.textContent=day;button.dataset.date=value;button.className='calendar-day';button.disabled=value<input.min||value>input.max;button.tabIndex=value===input.value?0:-1;button.setAttribute('aria-label',long.format(date));button.setAttribute('aria-pressed',String(value===input.value));
      button.addEventListener('click',()=>{input.value=value;sync();input.dispatchEvent(new Event('change',{bubbles:true}));close();trigger.focus();});
      button.addEventListener('keydown',event=>{const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];if(delta){event.preventDefault();const next=new Date(date);next.setDate(next.getDate()+delta);const nextValue=iso(next);if(nextValue<input.min||nextValue>input.max)return;if(next.getMonth()!==month.getMonth()||next.getFullYear()!==month.getFullYear()){month=new Date(next.getFullYear(),next.getMonth(),1,12);render();}focusDate(nextValue);}});grid.append(button);
    }
    panel.append(grid);const hint=document.createElement('div');hint.className='calendar-hint';hint.textContent='Выберите удобный день для поездки';panel.append(hint);
  }
  trigger.addEventListener('click',()=>{if(!panel.hidden){close();return;}month=parse(input.value);month.setDate(1);render();panel.hidden=false;trigger.setAttribute('aria-expanded','true');focusDate(input.value);});
  wrapper.addEventListener('keydown',event=>{if(event.key==='Escape'){close();trigger.focus();event.preventDefault();event.stopPropagation();}});
  document.addEventListener('click',event=>{if(!wrapper.contains(event.target))close();});input.addEventListener('change',sync);wrapper.append(trigger,panel);sync();
}

document.addEventListener('DOMContentLoaded',async()=>{await window.ppContentReady;const form=document.querySelector('.pp-form');if(!form)return;enhanceSelects(form);const date=form.elements.namedItem('Дата');date.max=new Date(Date.now()+365*86400000).toISOString().slice(0,10);enhanceCalendar(date);});

