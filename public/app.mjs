import {createChart,CandlestickSeries,LineSeries,HistogramSeries,CrosshairMode,LineStyle} from '/vendor/charts.mjs';
import {CATALOG,TABS,BY_ID,layouts,sourceId,descriptor,selectedKey,selectedInfo,changeSlot,undoSlot,promotePending,iexPlan} from './catalog.mjs';
import {readPrefs,savePrefs,sma,timelineFor,withWhitespace,chartRange,priceDigits} from './core.mjs';
const $=s=>document.querySelector(s),grid=$('#grid'),cards=new Map();
let prefs=readPrefs(localStorage),state=null,disconnected=false,lastContact=0,focused=null,syncing=false,applyingRange=false,detailId=null;
const active=()=>prefs.tabs[prefs.active],compact=new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2});
const shortDate=s=>s?new Date(s+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'}):'—';
const when=ms=>ms?new Date(ms).toLocaleString('en-GB',{timeZone:'UTC',hour12:false})+' UTC':'Not received';
const labels={'demo':'Synthetic demo','setup-required':'Setup required','daily-reference':'Daily reference',polling:'Polling · 60s',live:'Live',waiting:'Awaiting update','session-closed':'Session closed',stale:'Stale',reconnecting:'Reconnecting',disconnected:'Disconnected','feed-expansion':'Pending IEX','no-data':'No daily bars',unavailable:'Not connected','access-unavailable':'Access unavailable','awaiting-candle':'Awaiting daily bar','calendar-unknown':'Session unknown',loading:'Loading',connecting:'Connecting'};
const label=s=>labels[s]??s;
Object.assign(labels,{'candidate-polling':'CFD · 60s','proxy-polling':'Perp proxy · 60s'});
const ready=d=>d?.connection==='connected'&&d.bars.length>0&&!['stale','awaiting-candle','calendar-unknown'].includes(d.status);
const infoFor=id=>selectedInfo(prefs,id),dataFor=id=>state?.symbols[selectedKey(prefs,id)];
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const price=(item,n)=>Number.isFinite(n)?n.toLocaleString('en-US',{minimumFractionDigits:item.digits,maximumFractionDigits:item.digits}):'—';
function persist(){ $('#saved').textContent=savePrefs(localStorage,prefs)?'Saved in this browser':'Saving unavailable'; }
function syncControls(){document.querySelectorAll('[data-range]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.range===active().range)));for(const key of ['sma','volume','sync'])$('#'+key+'-toggle').setAttribute('aria-pressed',String(active()[key]));}
function createCard(id){
  const info=infoFor(id),card=document.createElement('section');card.className='card pending';card.dataset.symbol=id;card.dataset.instrument=info.id;card.setAttribute('aria-label',info.symbol+' daily chart');
  card.innerHTML=`<div class="card-head"><div class="instrument"><div class="symbol-line"><button class="symbol ticker-button" title="Change instrument" aria-label="Change ${escapeHtml(info.symbol)} instrument">${escapeHtml(info.symbol)} <span aria-hidden="true">⌄</span></button><span class="daily-badge">1D</span></div><div class="company" title="${escapeHtml(info.name)} · ${escapeHtml(sourceId(info))}">${escapeHtml(info.name)}</div><button class="pending-selection" hidden></button></div><div class="quote"><div class="last-price">—</div><div class="price-change">${info.currency??''}</div></div><button class="expand" aria-label="Expand ${id} chart" title="Expand chart">⛶</button></div><div class="chart-legend"><span class="sma-value">SMA 20 <b>—</b></span><span class="vol-value">Vol <b>—</b></span><span class="legend-date">—</span></div><div class="chart-wrap"><div class="chart"></div><div class="ohlc"></div><div class="empty-message"><span class="empty-icon">◇</span><strong>Connecting feed</strong><p>Checking daily data…</p></div></div><div class="card-bottom"><button class="feed-button" aria-label="${id} feed details">${info.feed} <span>↗</span></button><span class="bar-state">Connecting</span></div>`;
  grid.append(card);const item={id,info,card,chart:null,bars:[],barMap:new Map(),smaMap:new Map(),timeline:[],signature:null,hover:null,digits:2,rangeTouched:false};cards.set(id,item);
  if(info.candidate){
    const note=document.createElement('div'),text=document.createElement('span'),fallback=document.createElement('button');note.className='candidate-note';text.textContent=info.notice;fallback.textContent='Daily reference';fallback.setAttribute('aria-label','Use '+descriptor(info.fallbackId).symbol+' daily reference');
    fallback.onclick=()=>{if(!state?.symbols[info.fallbackId]?.bars.length){notify('The daily reference has no retained history yet. Your selection is unchanged.');return;}finishSelection(changeSlot(prefs,id,info.fallbackId),id,'Daily reference restored. Candidate history remains separate.');};
    note.append(text,fallback);card.insertBefore(note,card.querySelector('.chart-legend'));
  }
  card.querySelector('.feed-button').onclick=()=>openDetails(id);
  card.querySelector('.ticker-button').onclick=()=>openPicker(id);card.querySelector('.pending-selection').onclick=()=>openPicker(id);
  card.querySelector('.expand').onclick=()=>{focused=focused===id?null:id;grid.classList.toggle('single',Boolean(focused));for(const [s,c]of cards){c.card.classList.toggle('focused',s===focused);c.card.querySelector('.expand').setAttribute('aria-label',(focused===s?'Restore grid from ':'Expand ')+s+' chart');}updateHeader();};
  return item;
}
function initChart(item){
  const chart=createChart(item.card.querySelector('.chart'),{
    autoSize:true,layout:{background:{type:'solid',color:'#101721'},textColor:'#72849e',fontFamily:'-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',fontSize:10,attributionLogo:true,panes:{separatorColor:'#243043',separatorHoverColor:'#394c67',enableResize:false}},
    grid:{vertLines:{color:'#1b2634'},horzLines:{color:'#1b2634'}},crosshair:{mode:CrosshairMode.Normal,vertLine:{color:'#617797',style:LineStyle.Dashed,labelBackgroundColor:'#3d5274'},horzLine:{color:'#617797',style:LineStyle.Dashed,labelBackgroundColor:'#3d5274'}},
    rightPriceScale:{borderColor:'#253142',minimumWidth:54,entireTextOnly:true,scaleMargins:{top:.08,bottom:.08}},timeScale:{borderColor:'#253142',timeVisible:false,rightOffset:4,barSpacing:5,minBarSpacing:2,fixLeftEdge:false},localization:{locale:'en-US',dateFormat:'dd MMM yyyy'},handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:true},handleScroll:{mouseWheel:false,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},
  });
  item.chart=chart;item.candles=chart.addSeries(item.info.chartType==='line'?LineSeries:CandlestickSeries,{color:'#63c6be',lineWidth:2,upColor:'#42bea2',downColor:'#e67679',borderVisible:false,wickUpColor:'#42bea2',wickDownColor:'#e67679',priceLineColor:'#67889f',priceLineStyle:LineStyle.Dotted});
  item.average=chart.addSeries(LineSeries,{color:'#7c9df4',lineWidth:1,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false,visible:active().sma});
  if(item.info.volumeUnit!==null){item.volume=chart.addSeries(HistogramSeries,{priceFormat:{type:'volume'},priceLineVisible:false,lastValueVisible:false,visible:active().volume},1);
  item.volume.priceScale().applyOptions({scaleMargins:{top:.12,bottom:0},borderVisible:false});chart.panes()[0].setStretchFactor(4);chart.panes()[1].setStretchFactor(active().volume?1:.001);}
  for(const event of ['pointerdown','wheel'])item.card.querySelector('.chart').addEventListener(event,()=>{item.rangeTouched=true;},{passive:true,capture:true});
  const workspace=active();
  chart.timeScale().subscribeVisibleLogicalRangeChange(range=>{if(applyingRange||!item.rangeTouched||!range||!item.bars.length)return;workspace.ranges[item.id]={from:range.from,to:range.to};persist();});
  chart.subscribeCrosshairMove(event=>{
    if(syncing)return;const time=typeof event.time==='string'?event.time:event.time&&`${event.time.year}-${String(event.time.month).padStart(2,'0')}-${String(event.time.day).padStart(2,'0')}`;
    item.hover=time||null;renderLegend(item,time);if(!active().sync)return;syncing=true;
    for(const other of cards.values()){if(other===item||!other.chart)continue;const b=other.barMap.get(time);other.hover=time||null;if(time&&b)other.chart.setCrosshairPosition(b.close,time,other.candles);else other.chart.clearCrosshairPosition();renderLegend(other,time);}syncing=false;
  });
}
function renderLegend(item,time){
  const bar=time?item.barMap.get(time):item.bars.at(-1),avg=bar?item.smaMap.get(bar.time):undefined;
  const s=item.card.querySelector('.sma-value');s.hidden=!active().sma;s.querySelector('b').textContent=price(item,avg);s.title=avg===undefined?'SMA of 20 received daily closes':`SMA 20 close: ${avg}`;
  const v=item.card.querySelector('.vol-value');v.hidden=!active().volume;v.querySelector('b').textContent=Number.isFinite(bar?.volume)?compact.format(bar.volume):'n/a';v.title=Number.isFinite(bar?.volume)?`${bar.volume.toLocaleString('en-US',{maximumFractionDigits:8})} ${item.info.volumeUnit??''}`:'This reference series has no trading volume';
  item.card.querySelector('.legend-date').textContent=shortDate(time??bar?.time);
  const o=item.card.querySelector('.ohlc');o.classList.toggle('visible',Boolean(time));o.textContent=time?(bar?(item.info.chartType==='line'?`Reference ${price(item,bar.close)} · ${item.info.quoteUnit}`:`O ${price(item,bar.open)}  H ${price(item,bar.high)}  L ${price(item,bar.low)}  C ${price(item,bar.close)}`):'No observation for this date'):'';
}
function applyView(item,reset=false){if(!item.chart||!item.timeline.length)return;item.rangeTouched=false;applyingRange=true;item.chart.timeScale().setVisibleLogicalRange(chartRange(active(),item.timeline.length,item.id,reset,item.info));applyingRange=false;}
function updateCharts(){
  if(!state)return;
  for(const item of cards.values()){
    const data=dataFor(item.id)??{bars:[],status:item.info.route==='iex'?'feed-expansion':'unavailable',message:'No provider connected.'},bars=data.bars??[],signature=JSON.stringify(bars),last=bars.at(-1),previous=bars.at(-2);
    if(signature!==item.signature){
      const wasEmpty=!item.bars.length;item.signature=signature;item.bars=bars;item.barMap=new Map(bars.map(b=>[b.time,b]));item.timeline=timelineFor(bars,item.info.kind,item.info.calendar);item.digits=priceDigits(bars);
      const values=sma(bars);item.smaMap=new Map(values.map(b=>[b.time,b.value]));
      if(bars.length){
        if(!item.chart)initChart(item);const oldRange=item.chart.timeScale().getVisibleLogicalRange();applyingRange=true;
        const fmt={type:'price',precision:item.digits,minMove:10**-item.digits};item.candles.applyOptions({priceFormat:fmt});item.average.applyOptions({priceFormat:fmt});
        item.candles.setData(withWhitespace(item.info.chartType==='line'?bars.map(b=>({time:b.time,value:b.close})):bars,item.timeline));item.average.setData(withWhitespace(values,item.timeline));item.volume?.setData(withWhitespace(bars.map(b=>({time:b.time,value:b.volume,color:b.close>=b.open?'#2d756c':'#874d57'})),item.timeline));
        if(oldRange&&!wasEmpty)item.chart.timeScale().setVisibleLogicalRange(oldRange);applyingRange=false;
        if(wasEmpty)requestAnimationFrame(()=>requestAnimationFrame(()=>{if(cards.get(item.id)===item)applyView(item);}));
      }
      item.card.dataset.bars=String(bars.length);item.card.dataset.chartType=item.info.chartType??'candles';item.card.dataset.volume=item.volume?'available':'unavailable';item.card.dataset.first=bars[0]?.time??'';item.card.dataset.last=last?.time??'';
      item.card.querySelector('.last-price').textContent=price(item,last?.close)+(item.info.id==='US10Y'&&last?'%':'');item.card.querySelector('.last-price').title=item.info.quoteUnit??item.info.currency??'';
      const change=item.card.querySelector('.price-change');if(last&&previous){const delta=last.close-previous.close;change.className='price-change '+(delta>=0?'positive':'negative');change.textContent=item.info.id==='US10Y'?`${delta>=0?'+':''}${(delta*100).toFixed(1)} bp`:`${delta>=0?'+':''}${price(item,delta)} (${delta>=0?'+':''}${(delta/previous.close*100).toFixed(2)}%)`;}else change.textContent=item.info.currency??'';
      renderLegend(item,item.hover);
    }
    item.card.classList.toggle('pending',!bars.length);const empty=item.card.querySelector('.empty-message');empty.hidden=bars.length>0;
    empty.querySelector('strong').textContent=data.status==='feed-expansion'?'Awaiting IEX data':data.status==='reconnecting'?'Waiting for connection':data.status==='no-data'?'No daily bars returned':'Feed not connected';empty.querySelector('p').textContent=data.status==='feed-expansion'?'This symbol is waiting to be added to your IEX feed.':data.status==='no-data'?'IEX accepted this symbol, but no daily candles were returned.':data.message||item.info.reason||'Waiting for daily data.';
    const status=disconnected?'disconnected':data.status,el=item.card.querySelector('.bar-state');el.className='bar-state '+status;el.textContent=item.info.route==='xyz'&&status==='polling'?(data.externalClosed?'Perp · ref closed':'Perp · 60s'):label(status);el.title=data.externalSession??data.session??'';item.card.dataset.status=status;
    item.card.querySelector('.feed-button').title=`${sourceId(item.info)} · ${bars.length} daily bars${data.missing?.length?' · '+data.missing.length+' gaps':''}`;
    item.card.querySelector('.legend-date').title=last?`${last.time} · ${data.session}`:'';
    const pending=prefs.pending[item.id],badge=item.card.querySelector('.pending-selection');badge.hidden=!pending;badge.textContent=pending?`${descriptor(pending).symbol} queued · needs IEX setup`:'';
  }
}
function updateHeader(){
  const all=CATALOG.map(i=>dataFor(i.id)),count=all.filter(ready).length,current=active().order.map(dataFor),n=current.filter(ready).length,pending=current.filter(d=>!d||!d.bars.length).length;
  document.body.classList.toggle('disconnected',disconnected);const pill=$('#connection');pill.className='status-pill'+(disconnected?' error':count?' live':'');pill.querySelector('span').textContent=disconnected?'Local server disconnected':state?.demo?`${count} / 32 synthetic`:`${count} / 32 connected`;
  for(const b of document.querySelectorAll('[data-tab]')){const selected=b.dataset.tab===prefs.active;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;const total=disconnected?0:layouts[b.dataset.tab].filter(id=>ready(dataFor(id))).length;b.querySelector('small').textContent=`${total}/8`;}
  $('#mode-label').textContent=prefs.active;$('#mode-label').classList.toggle('live',n>0);
  const closed=current.filter(d=>d?.status==='session-closed').length,issues=current.filter(d=>d?.bars.length&&!ready(d)).length;
  $('#data-summary').textContent=disconnected?'Last received data retained · Reconnecting to local server…':`${n} of 8 connected${pending?' · '+pending+' awaiting feeds':''}${closed?' · '+closed+' sessions closed':''}${issues?' · '+issues+' need attention':''}${prefs.active==='Crypto'?' · Public feeds refresh every 60s':''}`;
  $('#session-label').textContent=prefs.active==='Crypto'?'UTC · 24/7':prefs.active==='AI'?'New York':'Venue sessions';
  $('#footer-status').textContent=focused?`${infoFor(focused).symbol} · Escape to return to the grid`:'Daily charts · SMA 20 close · Volume where available';
  if(state?.demo){$('#data-summary').textContent='SYNTHETIC DEMO · invented prices · no provider connection';$('#session-label').textContent='Synthetic dates';}
  if($('#feed-dialog').open)renderDetails();
}
function selectTab(tab){
  if(!TABS.includes(tab))return;for(const item of cards.values())item.chart?.remove();cards.clear();grid.replaceChildren();grid.classList.remove('single');focused=null;prefs.active=tab;
  grid.setAttribute('aria-label',tab+' daily charts');grid.setAttribute('aria-labelledby','tab-'+tab);for(const id of active().order)createCard(id);syncControls();updateCharts();updateHeader();persist();
}
function renderLayout(){
  $('#layout-title').textContent=prefs.active+' · Chart order';const list=$('#layout-list');list.replaceChildren();
  active().order.forEach((id,index)=>{const row=document.createElement('div');row.className='layout-row';row.innerHTML=`<span class="position">${index<4?'Top':'Bottom'} ${index%4+1}</span><strong>${escapeHtml(infoFor(id).symbol)}</strong><span class="name">${escapeHtml(infoFor(id).venue)}</span><button aria-label="Move ${id} earlier" ${index===0?'disabled':''}>←</button><button aria-label="Move ${id} later" ${index===7?'disabled':''}>→</button>`;row.querySelectorAll('button').forEach((b,j)=>b.onclick=()=>{const other=index+(j===0?-1:1);[active().order[index],active().order[other]]=[active().order[other],active().order[index]];for(const id of active().order)grid.append(cards.get(id).card);persist();renderLayout();});list.append(row);});
}
function openDetails(id=null){detailId=id;renderDetails();$('#feed-dialog').showModal();}
function renderDetails(){
  const content=$('#feed-content');content.replaceChildren();$('#feed-title').textContent=detailId?infoFor(detailId).symbol+' · Feed details':prefs.active+' · Feed coverage';
  if(detailId){
    const i=infoFor(detailId),d=dataFor(detailId);if(!d)return;const dl=document.createElement('dl');dl.className='feed-details';
    const fields={'Instrument':sourceId(i),'Feed':d.feed,'Status':disconnected?'Local server disconnected':label(d.status),'Mode':d.mode==='demo'?'Synthetic demonstration — not market data':d.mode==='candidate'?'Optional proxy candidate':d.mode==='reference'?'Daily reference (not live)':d.mode==='public'?'Public market data':d.mode==='live'?'Alpaca IEX connection':'Not connected',...(i.original?{'Original position':i.original,'Relationship':i.equivalent?'Explicit proxy or reference':'Same spot index, daily history','Quote unit':i.quoteUnit,'Chart':i.chartType==='line'?'Daily reference line; no intraday OHLC':'Daily OHLC candles'}:{}),...(i.candidate?{'Relationship':i.notice,'Quote unit':i.quoteUnit,'Underlying delay':d.sourceDelay??'Unknown','Latest source evidence':when(d.sourceTime),'Timestamp meaning':d.sourceTimeKind??'Unavailable','Provider response time':when(d.providerServerTime),'Latest daily candle opened':when(d.dailySessionOpen),'Next provider session':d.nextOpen?when(d.nextOpen):'Not provided','Fallback':descriptor(i.fallbackId).name,...(Number.isFinite(d.fundingRate)?{'Funding':`${(d.fundingRate*100).toFixed(4)}% / ${d.fundingInterval/3600}h`}:{})}:{}),'Session':d.session,...(d.externalSession?{'External reference':d.externalSession}:{}),'History':d.bars.length?`${d.bars.length} bars · ${d.bars[0].time} to ${d.bars.at(-1).time}`:'No candles received','Volume unit':d.volumeUnit??'Not applicable — no trading volume','Missing dates':String(d.missing?.length??0),'Last check':when(d.lastFetched),'Delivery':d.transport??'Not configured'};
    for(const [k,v]of Object.entries(fields)){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=v;dl.append(dt,dd);}content.append(dl);
    const note=document.createElement('p');note.textContent=i.difference??d.message;content.append(note);if(i.difference&&d.message!==i.difference){const p=document.createElement('p');p.textContent=d.message;content.append(p);}if(d.missing?.length){const p=document.createElement('p');p.textContent='No candle was returned for: '+d.missing.join(', ')+'. Empty dates remain empty; SMA uses the last 20 received closes.';content.append(p);}
  }else{
    const p=document.createElement('p');p.textContent='Click a ticker to change that chart. Selections and chart settings are saved in this browser. Each source retains its actual instrument type, freshness and session labels.';content.append(p);
    for(const id of active().order){const d=dataFor(id),button=document.createElement('button');button.className='coverage-row';const strong=document.createElement('strong');strong.textContent=infoFor(id).symbol;const span=document.createElement('span');span.textContent=(d?.feed??infoFor(id).feed)+' · '+label(disconnected?'disconnected':d?.status??'connecting');button.append(strong,span);button.onclick=()=>{detailId=id;renderDetails();};content.append(button);}
  }
}
let pickerSlot=null,pickerChoice=null,searchGeneration=0,searchTimer=null,pickerBusy=false,toastSlot=null;
function replaceCard(id){
  const old=cards.get(id);if(!old)return;const next=createCard(id);old.chart?.remove();old.card.replaceWith(next.card);next.card.classList.toggle('focused',focused===id);
}
function notify(message,slot=null){toastSlot=slot;$('#toast span').textContent=message;$('#toast-undo').hidden=!slot;$('#toast').hidden=false;}
function finishSelection(next,slot,message){prefs=next;persist();replaceCard(slot);updateCharts();updateHeader();notify(message,slot);}
function updatePickerCurrent(){
  const info=infoFor(pickerSlot),pending=prefs.pending[pickerSlot];
  $('#picker-title').textContent='Change '+info.symbol;
  $('#picker-current').textContent=`Current: ${sourceId(info)} · ${info.kind}${pending?' · Queued: '+descriptor(pending).symbol:''}`;
  $('#undo-slot').disabled=!prefs.undo[pickerSlot];$('#reset-slot').disabled=selectedKey(prefs,pickerSlot)===pickerSlot&&!pending;$('#clear-pending').hidden=!pending;
}
function openPicker(id){
  pickerSlot=id;pickerChoice=null;pickerBusy=false;$('#ticker-search').value='';$('#picker-choice').hidden=true;$('#picker-error').hidden=true;$('#apply-ticker').disabled=true;
  for(const b of document.querySelectorAll('[data-provider]'))b.setAttribute('aria-pressed',String(b.dataset.provider==='all'));
  updatePickerCurrent();$('#picker-dialog').showModal();$('#ticker-search').focus();searchInstruments();
}
function pickerError(message){$('#picker-error').textContent=message;$('#picker-error').hidden=false;}
function chooseInstrument(item){
  if(pickerBusy)return;pickerChoice=item;$('#picker-choice').hidden=false;$('#picker-error').hidden=true;
  $('#choice-name').textContent=sourceId(item)+' · '+(item.kind==='equity'?'US stock / ETF':item.kind);
  const pending=item.availability==='restart',same=item.id===selectedKey(prefs,pickerSlot);
  $('#choice-note').textContent=pending?`${item.symbol} is not in the current publisher. Queue it for the initial configurable-publisher start; ${infoFor(pickerSlot).symbol} remains displayed until valid IEX bars arrive. Availability is not yet verified.`:item.availability==='cached'?'Only cached data is currently available. Its stale or disconnected status will remain visible.':item.difference??(item.kind==='perpetual'?'Perpetual contract candles with base/contract volume. This is not a spot asset or a stock. Daily history is checked before replacement.':'Daily history is checked before replacement. Your range, indicators and chart position stay the same.');
  $('#apply-ticker').textContent=same?'Already selected':pending?'Queue IEX request':'Use instrument';$('#apply-ticker').disabled=same;
  for(const b of document.querySelectorAll('.picker-result'))b.setAttribute('aria-pressed',String(b.dataset.key===item.id));
}
async function searchInstruments(){
  const generation=++searchGeneration,query=$('#ticker-search').value,provider=$('#picker-filters [aria-pressed=true]')?.dataset.provider??'all';
  pickerChoice=null;$('#picker-choice').hidden=true;$('#apply-ticker').disabled=true;$('#picker-results').replaceChildren();$('#picker-search-status').textContent='Searching supported markets…';
  try{
    const response=await fetch('/api/instruments?'+new URLSearchParams({q:query,provider}),{signal:AbortSignal.timeout(25000)});if(!response.ok)throw Error('Instrument search is unavailable. The current chart is unchanged.');const result=await response.json();
    if(generation!==searchGeneration||!$('#picker-dialog').open)return;
    const exact=i=>[i.symbol,i.id,i.pair].some(x=>x?.toUpperCase()===query.trim().toUpperCase());
    result.items.sort((a,b)=>Number(exact(b))-Number(exact(a)));
    for(const item of result.items){
      const button=document.createElement('button');button.className='picker-result';button.dataset.key=item.id;button.setAttribute('aria-pressed','false');
      const main=document.createElement('span'),strong=document.createElement('strong'),name=document.createElement('small'),meta=document.createElement('span'),badge=document.createElement('em');
      strong.textContent=item.symbol;name.textContent=item.name;main.append(strong,name);meta.className='result-meta';if(item.route==='iex')item.venue='IEX';meta.textContent=`${item.venue}${item.venue.toLowerCase().includes(item.feed.toLowerCase())?'':' · '+item.feed} · ${item.kind==='equity'?'Stock / ETF':item.kind}`;
      badge.className='availability '+item.availability;badge.textContent=({ready:'Available',cached:'Cached',restart:'Needs IEX restart',check:'Check daily bars'})[item.availability];button.append(main,meta,badge);button.onclick=()=>chooseInstrument(item);$('#picker-results').append(button);
    }
    $('#picker-search-status').textContent=(result.items.length?`${result.items.length}${result.more?'+':''} matches${result.more?' · narrow your search':''}`:'No supported matches. Try the exact ticker and choose a provider.')+(result.notes.length?' · '+result.notes.join(' '):'');
  }catch(error){if(generation===searchGeneration)$('#picker-search-status').textContent=error.message==='Instrument search is unavailable. The current chart is unchanged.'?error.message:'Search could not finish. Your current chart is unchanged.';}
}
async function prepareInstrument(key){
  const response=await fetch('/api/instruments/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key}),signal:AbortSignal.timeout(30000)});let result;try{result=await response.json();}catch{throw Error('Instrument checks are unavailable. Your current chart is unchanged.');}
  if(!response.ok){const error=Error(result.error??'No data returned. Your current chart is unchanged.');error.status=response.status;throw error;}return result;
}
$('#apply-ticker').onclick=async()=>{
  if(!pickerChoice||pickerBusy)return;const choice=pickerChoice,slot=pickerSlot,generation=searchGeneration;pickerBusy=true;$('#apply-ticker').disabled=true;$('#apply-ticker').textContent='Checking daily bars…';$('#picker-error').hidden=true;
  try{const result=await prepareInstrument(choice.id);if(!$('#picker-dialog').open||generation!==searchGeneration||slot!==pickerSlot)return;
    const next=changeSlot(prefs,slot,result.item.id,{queue:result.pending});iexPlan(next);
    if(result.data&&state)state={...state,symbols:{...state.symbols,[result.item.id]:result.data}};
    finishSelection(next,slot,result.pending?`${choice.symbol} queued. ${infoFor(slot).symbol} stays until IEX data arrives.`:`Chart changed to ${choice.symbol}.`);$('#picker-dialog').close();
  }catch(error){if($('#picker-dialog').open&&slot===pickerSlot)pickerError(error.message);}finally{pickerBusy=false;if($('#picker-dialog').open&&slot===pickerSlot&&generation===searchGeneration){$('#apply-ticker').disabled=!pickerChoice;$('#apply-ticker').textContent=choice.availability==='restart'?'Queue IEX request':'Use instrument';}}
};
$('#ticker-search').oninput=()=>{clearTimeout(searchTimer);searchGeneration++;pickerChoice=null;$('#picker-choice').hidden=true;$('#apply-ticker').disabled=true;$('#picker-results').replaceChildren();$('#picker-search-status').textContent='Searching supported markets…';searchTimer=setTimeout(searchInstruments,250);};
$('#ticker-search').onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();$('#picker-results button')?.focus();}};
$('#picker-results').onkeydown=e=>{if(!['ArrowDown','ArrowUp'].includes(e.key))return;e.preventDefault();const buttons=[...$('#picker-results').querySelectorAll('button')],index=buttons.indexOf(document.activeElement);buttons[Math.max(0,Math.min(buttons.length-1,index+(e.key==='ArrowDown'?1:-1)))]?.focus();};
for(const button of document.querySelectorAll('[data-provider]'))button.onclick=()=>{if(pickerBusy)return;for(const b of document.querySelectorAll('[data-provider]'))b.setAttribute('aria-pressed',String(b===button));searchInstruments();};
$('#picker-dialog').addEventListener('close',()=>{searchGeneration++;clearTimeout(searchTimer);pickerChoice=null;});
$('#undo-slot').onclick=()=>{if(!prefs.undo[pickerSlot])return;finishSelection(undoSlot(prefs,pickerSlot),pickerSlot,'Previous instrument restored.');$('#picker-dialog').close();};
$('#reset-slot').onclick=()=>{finishSelection(changeSlot(prefs,pickerSlot,pickerSlot),pickerSlot,'Original instrument restored.');$('#picker-dialog').close();};
$('#clear-pending').onclick=()=>{finishSelection(changeSlot(prefs,pickerSlot,selectedKey(prefs,pickerSlot)),pickerSlot,'Queued request cancelled.');$('#picker-dialog').close();};
$('#toast-undo').onclick=()=>{if(toastSlot){const slot=toastSlot;finishSelection(undoSlot(prefs,slot),slot,'Previous instrument restored.');$('#toast-undo').hidden=true;}};
$('#toast-close').onclick=()=>{$('#toast').hidden=true;};
$('#export-iex').onclick=()=>{try{const plan=iexPlan(prefs),url=URL.createObjectURL(new Blob([JSON.stringify(plan,null,2)+'\n'],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='iex-symbols.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify(`Exported ${plan.symbols.length} ticker names only. The current IEX process is unchanged.`);}catch(error){pickerError(error.message);}};
const restoring=new Set(),restoreAfter=new Map();
async function restoreCustomSelections(){
  if(!state?.capabilities?.picker)return;
  for(const key of new Set(Object.values(prefs.selections)))if(!state.symbols[key]&&!restoring.has(key)&&Date.now()>(restoreAfter.get(key)??0)){
    restoring.add(key);
    try{const result=await prepareInstrument(key);if(result.data){state.symbols[key]=result.data;updateCharts();updateHeader();}}
    catch(error){restoreAfter.set(key,[403,404].includes(error.status)?Infinity:Date.now()+60000);notify('A saved instrument could not reconnect. Its chart remains selected; open its ticker to retry or choose another source.');}finally{restoring.delete(key);}
  }
}
async function keepSelections(){
  if(!state?.capabilities?.picker)return;const keys=[...new Set([...Object.values(prefs.selections),...Object.values(prefs.undo).map(x=>x.selection)])];if(!keys.length)return;
  try{await fetch('/api/instruments/keep',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keys}),signal:AbortSignal.timeout(5000)});}catch{}
}

for(const tab of TABS){const button=document.createElement('button');button.type='button';button.id='tab-'+tab;button.dataset.tab=tab;button.setAttribute('role','tab');button.setAttribute('aria-controls','grid');button.innerHTML=`${tab}<small>0/8</small>`;button.onclick=()=>selectTab(tab);button.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?3:(TABS.indexOf(tab)+(e.key==='ArrowRight'?1:3))%4;selectTab(TABS[next]);$('#tab-'+TABS[next]).focus();}};$('#tabs [role=tablist]').append(button);}
selectTab(prefs.active);
for(const b of document.querySelectorAll('[data-range]'))b.onclick=()=>{active().range=b.dataset.range;active().ranges={};for(const i of cards.values())applyView(i,true);syncControls();persist();};
for(const key of ['sma','volume','sync'])$('#'+key+'-toggle').onclick=()=>{active()[key]=!active()[key];for(const item of cards.values()){if(item.chart){item.average.applyOptions({visible:active().sma});item.volume?.applyOptions({visible:active().volume});if(key==='volume'&&item.volume)item.chart.panes()[1].setStretchFactor(active().volume?1:.001);if(!active().sync){item.chart.clearCrosshairPosition();item.hover=null;}}renderLegend(item,item.hover);}syncControls();persist();};
$('#reset-view').onclick=()=>{active().ranges={};for(const item of cards.values()){item.chart?.priceScale('right').applyOptions({autoScale:true});applyView(item,true);}persist();};
$('#layout-button').onclick=()=>{renderLayout();$('#layout-dialog').showModal();};$('#restore-layout').onclick=()=>{active().order=[...layouts[prefs.active]];for(const id of active().order)grid.append(cards.get(id).card);persist();renderLayout();};$('#connection').onclick=()=>openDetails();
document.querySelectorAll('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());document.addEventListener('keydown',e=>{if(e.key==='Escape'&&focused&&!document.querySelector('dialog[open]'))cards.get(focused).card.querySelector('.expand').click();});
function onState(next){if(!next||next.version!==1||!next.symbols)throw Error('Invalid overview state');state=next;lastContact=Date.now();disconnected=false;document.querySelector('[data-provider=gate]').hidden=!next.capabilities?.gateCandidates;document.querySelector('.local-tag').textContent=next.demo?'DEMO':'LOCAL';$('#preview-note').hidden=!next.demo;$('#preview-note').textContent='SYNTHETIC DEMO — invented prices for UI testing. No market-data requests or credentials.';const promoted=promotePending(prefs,state);if(promoted!==prefs){const changed=active().order.filter(id=>selectedKey(prefs,id)!==selectedKey(promoted,id));prefs=promoted;for(const id of changed)replaceCard(id);persist();notify('Queued IEX selection is now receiving daily bars.');}updateCharts();updateHeader();restoreCustomSelections();}
function markDisconnected(){disconnected=true;updateCharts();updateHeader();}
try{const r=await fetch('/api/state');if(!r.ok)throw Error();onState(await r.json());await restoreCustomSelections();}catch{markDisconnected();}
const events=new EventSource('/api/events');events.onmessage=e=>{try{onState(JSON.parse(e.data));}catch{markDisconnected();}};events.onerror=markDisconnected;
setInterval(()=>{if(lastContact&&Date.now()-lastContact>45000)markDisconnected();},10000);
window.addEventListener('pagehide',()=>events.close());window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});

setInterval(keepSelections,120000);
