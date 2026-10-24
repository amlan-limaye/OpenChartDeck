// Publication calendars, not exchange trading entitlements. Unknown years stay explicit.
import {isSession} from './iex-core.mjs';
const DAY=86400000;
const iso=n=>new Date(n).toISOString().slice(0,10);
function easter(y){const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),n=h+l-7*m+114;return Date.UTC(y,Math.floor(n/31)-1,n%31+1);}
function observed(y,m,d){const t=Date.UTC(y,m-1,d),w=new Date(t).getUTCDay();return iso(t+(w===6?-1:w===0?1:0)*DAY);}
function nth(y,m,weekday,n){const start=Date.UTC(y,m-1,1);return iso(start+((weekday-new Date(start).getUTCDay()+7)%7+7*(n-1))*DAY);}
function last(y,m,weekday){const end=Date.UTC(y,m,0);return iso(end-((new Date(end).getUTCDay()-weekday+7)%7)*DAY);}
export function referenceDay(date,calendar){
  const t=Date.parse(date+'T00:00:00Z'),d=new Date(t),y=d.getUTCFullYear();
  if(d.getUTCDay()===0||d.getUTCDay()===6)return false;
  if(calendar==='cboe')return isSession(date);
  if(calendar==='target')return !new Set([`${y}-01-01`,`${y}-05-01`,`${y}-12-25`,`${y}-12-26`,iso(easter(y)-2*DAY),iso(easter(y)+DAY)]).has(date);
  if(calendar==='treasury')return !new Set([observed(y,1,1),observed(y+1,1,1),nth(y,1,1,3),nth(y,2,1,3),last(y,5,1),observed(y,6,19),observed(y,7,4),nth(y,9,1,1),nth(y,10,1,2),observed(y,11,11),nth(y,11,4,4),observed(y,12,25),iso(easter(y)-2*DAY),'2025-01-09']).has(date);
  throw Error('Unknown publication calendar');
}
export function referenceDates(first,last,calendar){
  if(!first||!last)return [];
  const start=Date.parse(first+'T00:00:00Z'),end=Date.parse(last+'T00:00:00Z');
  if(!Number.isFinite(start)||!Number.isFinite(end)||end-start>2000*DAY)throw Error('Invalid reference history span');
  const dates=[];for(let t=start;t<=end;t+=DAY){const d=iso(t);if(referenceDay(d,calendar))dates.push(d);}return dates;
}
function localParts(now,timeZone){const p=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);const get=k=>p.find(x=>x.type===k).value;return {date:`${get('year')}-${get('month')}-${get('day')}`,hour:Number(get('hour'))};}
export function expectedReferenceDate(calendar,now=Date.now()){
  // Conservative check deadlines: ECB 18:00 Frankfurt, Treasury 20:00 NY,
  // Cboe 08:00 NY on the following day. These are app tolerances, not SLAs.
  const local=localParts(now,calendar==='target'?'Europe/Berlin':'America/New_York');
  let t=Date.parse(local.date+'T00:00:00Z');
  if(calendar==='cboe'){t-=DAY;if(local.hour<8)t-=DAY;}
  else if(local.hour<(calendar==='target'?18:20))t-=DAY;
  for(let i=0;i<12;i++,t-=DAY){const day=iso(t);if(referenceDay(day,calendar))return day;}
  throw Error('Publication calendar unavailable');
}
export function referenceStatus(data,now=Date.now()){
  if(data.connection!=='connected')return data.status;
  if(!data.lastFetched||now-data.lastFetched>Math.max(3*data.pollMs,10800000))return 'stale';
  const year=new Date(now).getUTCFullYear();if(year<2025||year>2028)return 'calendar-unknown';
  const last=data.bars.at(-1)?.time;if(!last||last<expectedReferenceDate(data.calendar,now))return 'stale';
  return 'daily-reference';
}
export function externalReferenceSession(item,now=Date.now()){
  const korea=item.id==='KOSPI',zone=korea?'Asia/Seoul':'America/New_York',local=localParts(now,zone),w=new Date(local.date+'T12:00:00Z').getUTCDay();
  const closed=korea?(w===0||(w===6&&local.hour>=6)||(w===1&&local.hour<8)):(w===6||(w===5&&local.hour>=17)||(w===0&&local.hour<(item.id==='USDJPY'?17:18)));
  return {externalClosed:closed,externalSession:closed?'External reference markets closed for the weekend; displayed candles are perpetual trades.':'External reference follows its market schedule. Holiday and maintenance state is not independently verified; displayed candles are perpetual trades.'};
}
