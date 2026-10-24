import { TABS, layouts, BY_ID } from './catalog.mjs';
export { sma, sessionsBetween, withWhitespace } from './iex-core.mjs';
import { sessionsBetween } from './iex-core.mjs';
import {referenceDates} from './reference.mjs';
import {sanitizeSelections} from './catalog.mjs';
export const DAY=86400000, STORE_KEY='openchartdeck:v1', LEGACY_STORE_KEY='openchartdeck:legacy';
export function utcDate(ms){
  if(!Number.isSafeInteger(ms)||ms%DAY!==0)throw Error('Daily candle must open at UTC midnight');
  return new Date(ms).toISOString().slice(0,10);
}
export function validDate(time){
  if(typeof time!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(time)||new Date(time+'T12:00:00Z').toISOString().slice(0,10)!==time)throw Error('Invalid daily date');
  return time;
}
export function validBar(raw,{noVolume=false}={}){
  const {time,open,high,low,close,volume}=raw;
  validDate(time);
  if(![open,high,low,close].every(n=>typeof n==='number'&&Number.isFinite(n))||!(noVolume?volume===null:typeof volume==='number'&&Number.isFinite(volume)&&volume>=0)||low<=0||high<Math.max(open,close,low)||low>Math.min(open,close))throw Error('Invalid OHLCV');
  return {time,open,high,low,close,volume};
}
export function normalizeBars(rows,options={}){
  if(!Array.isArray(rows))throw Error('Expected daily bars');
  const map=new Map();for(const row of rows){const b=validBar(row,options);map.set(b.time,b);}
  return [...map.values()].sort((a,b)=>a.time.localeCompare(b.time));
}
export function calendarDays(first,last){
  if(!first||!last)return [];
  const start=Date.parse(first+'T00:00:00Z'),end=Date.parse(last+'T00:00:00Z');
  if(!Number.isFinite(start)||!Number.isFinite(end)||end-start>2000*DAY)throw Error('Invalid history span');
  return Array.from({length:Math.max(0,Math.floor((end-start)/DAY)+1)},(_,i)=>utcDate(start+i*DAY));
}
export function timelineFor(bars,kind,calendar){
  const dates=bars.map(b=>b.time);
  // CFD holidays are not independently mapped. Show missing weekdays, never
  // invent broker sessions or mark the normal weekend as missing trading data.
  const expected=kind==='cfd'?calendarDays(dates[0],dates.at(-1)).filter(d=>![0,6].includes(new Date(d+'T12:00:00Z').getUTCDay())):kind==='reference'?referenceDates(dates[0],dates.at(-1),calendar):kind==='equity'?sessionsBetween(dates[0],dates.at(-1)):calendarDays(dates[0],dates.at(-1));
  return [...new Set([...expected,...dates])].sort();
}
export function gaps(bars,kind,calendar){const set=new Set(bars.map(b=>b.time));return timelineFor(bars,kind,calendar).filter(d=>!set.has(d));}
export function pollStatus(data,now=Date.now()){
  if(data.connection!=='connected')return data.status;
  if(!data.lastFetched||now-data.lastFetched>180000)return 'stale';
  if(data.bars.at(-1)?.time!==new Date(now).toISOString().slice(0,10))return 'awaiting-candle';
  return 'polling';
}
export function sanitizePrefs(raw){
  const p=raw&&typeof raw==='object'?raw:{}, tabs={};
  for(const tab of TABS){
    const t=p.tabs?.[tab]??{},def=layouts[tab];
    const order=Array.isArray(t.order)&&t.order.length===8&&new Set(t.order).size===8&&t.order.every(s=>def.includes(s))?[...t.order]:[...def];
    const ranges={};
    for(const [id,r] of Object.entries(t.ranges??{}))if(def.includes(id)&&r&&Number.isFinite(r.from)&&Number.isFinite(r.to)&&r.from>-5000&&r.to<5000&&r.to>r.from)ranges[id]={from:r.from,to:r.to};
    tabs[tab]={order,range:['1M','3M','6M','All'].includes(t.range)?t.range:'3M',sma:typeof t.sma==='boolean'?t.sma:true,volume:typeof t.volume==='boolean'?t.volume:true,sync:typeof t.sync==='boolean'?t.sync:true,ranges};
  }
  return {version:2,active:TABS.includes(p.active)?p.active:'Gold',tabs,...sanitizeSelections(p)};
}
export function readPrefs(storage){try{return sanitizePrefs(JSON.parse(storage.getItem(STORE_KEY)??storage.getItem(LEGACY_STORE_KEY)));}catch{return sanitizePrefs({});}}
export function savePrefs(storage,prefs){try{storage.setItem(STORE_KEY,JSON.stringify(sanitizePrefs(prefs)));return true;}catch{return false;}}
export function chartRange(prefs,length,id,reset=false,info=BY_ID[id]){
  const saved=reset?undefined:prefs.ranges[id],crypto=['binance','hyperliquid','xyz','gate-perp'].includes(info.route);
  const count=({'1M':crypto?30:22,'3M':crypto?90:64,'6M':crypto?180:126,All:length}[prefs.range]);
  return saved??{from:Math.max(0,length-count),to:length+3};
}
export function priceDigits(bars){const value=bars.at(-1)?.close??1;return value<0.01?8:value<1?5:value<10?4:2;}
