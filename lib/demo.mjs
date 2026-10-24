// Deterministic invented values. Never loads a provider response or private file.
import {FeedHub} from './feeds.mjs';
import {CATALOG,CANDIDATES,descriptor} from '../public/catalog.mjs';
import {DAY,normalizeBars} from '../public/core.mjs';
import {isSession} from '../public/iex-core.mjs';

export function syntheticBars(item,index=0){
  const bars=[];
  for(let day=0;day<160;day++){
    const time=new Date(Date.UTC(2025,0,2)+day*DAY).toISOString().slice(0,10);
    if(item.kind==='equity'&&!isSession(time))continue;
    if(item.kind==='reference'&&[0,6].includes(new Date(time).getUTCDay()))continue;
    const base=item.id==='US10Y'?3:30+index*7;
    const open=base+day*.025+Math.sin(day*.19+index)*base*.045;
    const close=open+Math.cos(day*.37+index)*base*.012;
    bars.push({time,open:item.chartType==='line'?close:open,close,
      high:item.chartType==='line'?close:Math.max(open,close)+base*.018,
      low:item.chartType==='line'?close:Math.min(open,close)-base*.018,
      volume:item.volumeUnit===null?null:1000+((day*7919+index*503)%9000)});
  }
  return normalizeBars(bars,{noVolume:item.volumeUnit===null});
}
export function createDemoFeed(){
  const hub=new FeedHub({fetcher:async()=>{throw Error('Demo never requests external data');}});
  const items=[...CATALOG,...CANDIDATES,descriptor('IEX:TSLA')];
  items.forEach((item,index)=>{
    hub.items.set(item.id,item);hub.leases.set(item.id,hub.now());
    hub.symbols[item.id]={bars:syntheticBars(item,index),missing:[],mode:'demo',status:'demo',connection:'connected',feed:'Synthetic demo',message:'Invented demonstration prices. No provider data.',lastFetched:null,lastReceived:null,session:'Synthetic example dates',volumeUnit:item.volumeUnit,sourceDelay:'Not applicable — invented values',transport:'Offline deterministic generator'};
  });
  hub.binanceMeta={at:hub.now(),value:{symbols:CATALOG.filter(i=>i.route==='binance').map(i=>({symbol:i.pair,status:'TRADING',contractType:'PERPETUAL',baseAsset:i.id,quoteAsset:'USDT'}))}};
  hub.xyzMeta={at:hub.now(),value:{universe:CATALOG.filter(i=>i.route==='xyz').map(i=>({name:i.pair,isDelisted:false}))}};
  hub.snapshot=()=>({version:1,demo:true,capabilities:{picker:1,gateCandidates:1},serverTime:hub.now(),symbols:structuredClone(hub.symbols)});
  hub.start=()=>{hub.stopped=false;hub.publish();};
  hub.refreshIex=async()=>true;
  return hub;
}
