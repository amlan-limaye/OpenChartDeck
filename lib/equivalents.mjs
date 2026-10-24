import {DAY,validDate,normalizeBars} from '../public/core.mjs';
export const CBOE_URL='https://cdn-api.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv';
export const TREASURY_URL='https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml';
export const FX_URL='https://api.frankfurter.dev/v2/rates';
export const ECB_URL='https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml';
export const DXY_WEIGHTS={EUR:.576,JPY:.136,GBP:.119,CAD:.091,SEK:.042,CHF:.036};
const day=ms=>new Date(ms).toISOString().slice(0,10);
function number(v){if(!['number','string'].includes(typeof v)||String(v).trim()===''||!Number.isFinite(Number(v)))throw Error('Invalid reference number');return Number(v);}
function checkDate(date,now){validDate(date);if(date>day(now))throw Error('Future reference observation');return date;}
export function normalizePoints(rows){
  const map=new Map();for(const row of rows){validDate(row.time);if(typeof row.close!=='number'||!Number.isFinite(row.close)||row.volume!==null||Object.hasOwn(row,'open')||Object.hasOwn(row,'high')||Object.hasOwn(row,'low'))throw Error('Invalid daily reference point');map.set(row.time,{time:row.time,close:row.close,volume:null});}
  return [...map.values()].sort((a,b)=>a.time.localeCompare(b.time));
}
export function parseDxy(rows,now=Date.now()){
  if(!Array.isArray(rows)||rows.length>6000)throw Error('Invalid ECB response');const dates=new Map();
  for(const r of rows){const date=checkDate(r.date,now);if(r.base!=='USD'||!Object.hasOwn(DXY_WEIGHTS,r.quote))throw Error('Wrong ECB currency');const rate=number(r.rate);if(rate<=0)throw Error('Invalid FX rate');if(!dates.has(date))dates.set(date,{});const rates=dates.get(date);if(Object.hasOwn(rates,r.quote))throw Error('Duplicate currency fixing');rates[r.quote]=rate;}
  // All six rates must share a date. Incomplete baskets remain gaps.
  const points=[];for(const [time,rates]of dates){if(Object.keys(rates).length!==6)continue;let close=50.14348112;for(const [quote,weight]of Object.entries(DXY_WEIGHTS))close*=rates[quote]**weight;points.push({time,close,volume:null});}
  return normalizePoints(points);
}
// ECB publishes EUR-base fixings. Convert all six components from the same day
// before calculating the indicative basket; never mix dates or invent OHLCV.
export function parseEcbDxy(xml,now=Date.now()){
  if(typeof xml!=='string'||xml.length>2000000||/<!DOCTYPE|<!ENTITY/i.test(xml)||!xml.includes('</gesmes:Envelope>'))throw Error('Invalid ECB XML');
  const rows=[],dates=new Set();
  for(const match of xml.matchAll(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]\s*>([\s\S]*?)<\/Cube>/g)){
    const date=checkDate(match[1],now),rates={};
    if(dates.has(date))throw Error('Duplicate ECB fixing');dates.add(date);
    for(const quote of match[2].matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([^'"]+)['"]\s*\/>/g)){
      if(Object.hasOwn(rates,quote[1]))throw Error('Duplicate ECB currency');
      const rate=number(quote[2]);if(rate<=0)throw Error('Invalid ECB rate');rates[quote[1]]=rate;
    }
    if(!['USD','JPY','GBP','CAD','SEK','CHF'].every(q=>Object.hasOwn(rates,q)))continue;
    for(const quote of Object.keys(DXY_WEIGHTS))rows.push({date,base:'USD',quote,rate:quote==='EUR'?1/rates.USD:rates[quote]/rates.USD});
  }
  if(!dates.size||dates.size>100)throw Error('Invalid ECB fixing dates');
  const result=parseDxy(rows,now);if(!result.length)throw Error('No complete ECB baskets');return result;
}
export function parseTreasury(xml,now=Date.now()){
  if(typeof xml!=='string'||xml.length>2000000||/<!DOCTYPE|<!ENTITY/i.test(xml)||!xml.includes('<feed'))throw Error('Invalid Treasury XML');
  const result=[];for(const match of xml.matchAll(/<m:properties>([\s\S]*?)<\/m:properties>/g)){
    const part=match[1],dates=[...part.matchAll(/<d:NEW_DATE\b[^>]*>([^<]+)<\/d:NEW_DATE>/g)],values=[...part.matchAll(/<d:BC_10YEAR\b[^>]*>([^<]+)<\/d:BC_10YEAR>/g)];
    if(dates.length!==1)throw Error('Invalid Treasury date');
    if(!values.length&&/<d:BC_10YEAR\b[^>]*m:null="true"/.test(part))continue;
    if(values.length!==1||!/^\d{4}-\d{2}-\d{2}T00:00:00$/.test(dates[0][1]))throw Error('Invalid Treasury 10-year observation');
    result.push({time:checkDate(dates[0][1].slice(0,10),now),close:number(values[0][1]),volume:null});
  }
  if(!result.length)throw Error('No Treasury observations');
  return normalizePoints(result);
}
export function parseVix(csv,now=Date.now()){
  if(typeof csv!=='string'||csv.length>2000000)throw Error('Invalid VIX download');const lines=csv.trim().split(/\r?\n/);if(lines.shift()!=='DATE,OPEN,HIGH,LOW,CLOSE')throw Error('Unexpected VIX CSV schema');
  const rows=[];const first=day(now-400*DAY);
  for(const line of lines){const p=line.split(',');if(p.length!==5||!/^\d{2}\/\d{2}\/\d{4}$/.test(p[0]))throw Error('Invalid VIX row');const [m,d,y]=p[0].split('/'),time=checkDate(`${y}-${m}-${d}`,now);if(time<first)continue;rows.push({time,open:number(p[1]),high:number(p[2]),low:number(p[3]),close:number(p[4]),volume:null});}
  return normalizeBars(rows,{noVolume:true});
}
export function verifyXyz(meta,pair){const matches=meta?.universe?.filter(m=>m.name===pair);return Boolean(matches?.length===1&&matches[0].isDelisted!==true);}
export function mergeReference(previous,incoming,chartType,now){const rows=[...previous,...incoming].filter(r=>r.time>=day(now-400*DAY));return chartType==='line'?normalizePoints(rows):normalizeBars(rows,{noVolume:true});}
