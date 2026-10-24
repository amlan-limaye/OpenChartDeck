import {DAY, normalizeBars} from '../public/core.mjs';

export const GATE='https://api.gateio.ws/api/v4';
export const GATE_POLL_MS=60000;
const number=value=>{
  if(!['number','string'].includes(typeof value)||String(value).trim()==='')throw Error('Missing Gate number');
  const n=Number(value);if(!Number.isFinite(n))throw Error('Invalid Gate number');return n;
};
const positive=value=>{const n=number(value);if(n<=0)throw Error('Nonpositive Gate price');return n;};
function timestamp(value,now,{seconds=false}={}){
  const n=number(value)*(seconds?1000:1);
  if(!Number.isSafeInteger(n)||n<=0||n>now+60000)throw Error('Invalid Gate timestamp');return n;
}
export function envelope(value,now){
  if(!value||value.label!==''||!value.data)throw Error('Gate response did not succeed');
  const serverTime=timestamp(value.timestamp,now);
  if(now-serverTime>180000)throw Error('Gate response server time is stale');
  return {data:value.data,serverTime};
}
export function verifyGateCfd(value,now){
  const {data}=envelope(value,now);
  const rows=Array.isArray(data)?data:data.list;
  if(!Array.isArray(rows))throw Error('Invalid Gate catalog');
  const matches=rows.filter(x=>x.symbol==='USIDX');
  if(matches.length!==1||matches[0].symbol_desc!=='US Dollar Index'||!['open','closed'].includes(matches[0].status)||matches[0].trade_mode!=='4')throw Error('Dollar-index CFD unavailable');
  return true;
}
export function verifyGatePerp(value){
  if(value?.name!=='VOLX_USDT'||value.type!=='direct'||value.in_delisting!==false||positive(value.quanto_multiplier)!==0.1)throw Error('Unexpected or inactive volatility perpetual');
  const fundingInterval=number(value.funding_interval);
  if(!Number.isSafeInteger(fundingInterval)||fundingInterval<3600||fundingInterval>86400)throw Error('Invalid funding interval');
  return {multiplier:0.1,fundingInterval};
}
export function cfdSessionDate(seconds,now){
  const ms=timestamp(seconds,now,{seconds:true}),date=new Date(ms),hour=date.getUTCHours();
  // These are the observed broker-day starts. Fail closed if the convention
  // changes; never silently label a 21:00/22:00 UTC start as the prior session.
  if(![0,21,22].includes(hour)||date.getUTCMinutes()||date.getUTCSeconds())throw Error('Unrecognized CFD daily boundary');
  return new Date(ms+(hour?12*3600000:0)).toISOString().slice(0,10);
}
export function parseGateCandles(value,{cfd=false,now=Date.now()}={}){
  const rows=cfd?envelope(value,now).data.list:value;
  if(!Array.isArray(rows)||!rows.length||rows.length>500)throw Error('Invalid Gate daily history');
  const seen=new Set();
  const bars=rows.map(r=>{
    const ms=timestamp(r.t,now,{seconds:true});
    if(!cfd&&ms%DAY!==0)throw Error('Unexpected perpetual candle boundary');
    const time=cfd?cfdSessionDate(r.t,now):new Date(ms).toISOString().slice(0,10);
    if(seen.has(time))throw Error('Duplicate Gate candle');seen.add(time);
    const volume=cfd?null:number(r.v);
    if(!cfd&&(!Number.isSafeInteger(volume)||volume<0))throw Error('Invalid contract volume');
    return {time,open:positive(r.o),high:positive(r.h),low:positive(r.l),close:positive(r.c),volume};
  });
  return {bars:normalizeBars(bars,{noVolume:cfd}),dailySessionOpen:Math.max(...rows.map(r=>Number(r.t)*1000))};
}
export function cfdEvidence(ticker,minute,now){
  const {data,serverTime}=envelope(ticker,now),rows=envelope(minute,now).data.list;
  if(!['open','closed'].includes(data.status)||data.trade_mode!=='4'||!Array.isArray(rows)||!rows.length||rows.length>5)throw Error('Invalid CFD session evidence');
  const times=rows.map(r=>{
    const t=timestamp(r.t,now,{seconds:true});if(t%60000!==0)throw Error('Invalid minute boundary');
    const o=positive(r.o),h=positive(r.h),l=positive(r.l),c=positive(r.c);
    if(h<Math.max(o,l,c)||l>Math.min(o,c))throw Error('Invalid minute candle');return t;
  });
  if(new Set(times).size!==times.length)throw Error('Duplicate minute bar');
  const quoteBid=positive(data.bid_price),quoteAsk=positive(data.ask_price);
  if(quoteBid>quoteAsk)throw Error('Crossed CFD quote');
  const nextOpen=number(data.next_open_time)*1000;
  if(nextOpen<0||!Number.isSafeInteger(nextOpen))throw Error('Invalid next session');
  return {providerServerTime:serverTime,sourceTime:Math.max(...times),sourceTimeKind:'Latest minute-bar open; not an underlying quote timestamp',marketStatus:data.status,nextOpen,quoteBid,quoteAsk};
}
export function perpEvidence(tickers,book,now){
  if(!Array.isArray(tickers)||tickers.length!==1||tickers[0].contract!=='VOLX_USDT')throw Error('Wrong perpetual ticker');
  const t=tickers[0],providerServerTime=timestamp(book?.current,now,{seconds:true}),sourceTime=timestamp(book?.update,now,{seconds:true});
  if(sourceTime>providerServerTime||now-providerServerTime>180000)throw Error('Invalid order-book time');
  const quoteBid=positive(book.bids?.[0]?.p),quoteAsk=positive(book.asks?.[0]?.p);
  if(quoteBid>quoteAsk)throw Error('Crossed perpetual book');
  return {providerServerTime,sourceTime,sourceTimeKind:'Order-book update; not last trade or official VIX time',marketStatus:'perpetual',quoteBid,quoteAsk,fundingRate:number(t.funding_rate),indexPrice:positive(t.index_price),markPrice:positive(t.mark_price),trailingQuoteVolume:number(t.volume_24h_quote)};
}
export function gateStatus(data,now=Date.now()){
  if(data.connection!=='connected')return data.status;
  if(!data.lastFetched||now-data.lastFetched>180000||!data.sourceTime||!data.dailySessionOpen)return 'stale';
  if(data.marketStatus==='closed'){
    if(now-data.sourceTime>8*DAY||now-data.dailySessionOpen>8*DAY)return 'stale';
    return data.nextOpen>now?'session-closed':'calendar-unknown';
  }
  if(now-data.sourceTime>300000||now-data.dailySessionOpen>36*3600000)return 'stale';
  return data.marketStatus==='perpetual'?'proxy-polling':'candidate-polling';
}
