import test from 'node:test';
import assert from 'node:assert/strict';
import {GATE,verifyGateCfd,verifyGatePerp,parseGateCandles,cfdSessionDate,cfdEvidence,perpEvidence,gateStatus} from '../lib/gate.mjs';
import {FeedHub} from '../lib/feeds.mjs';
import {InstrumentPicker} from '../lib/picker.mjs';
import {CANDIDATES,CATALOG,descriptor,changeSlot,undoSlot,selectedKey} from '../public/catalog.mjs';
import {DAY,sma,gaps,sanitizePrefs,savePrefs,readPrefs} from '../public/core.mjs';
const NOW=Date.parse('2026-10-24T12:00:00Z'),MIDNIGHT=Date.parse('2026-10-24T00:00:00Z'),OPEN=Date.parse('2026-10-22T21:00:00Z');
const [CFD,PERP]=CANDIDATES,close=100;
const candles=(cfd=false)=>Array.from({length:60},(_,i)=>({t:((cfd?OPEN:MIDNIGHT)-(59-i)*DAY)/1000,o:String(close+i),h:String(close+i+2),l:String(close+i-1),c:String(close+i+1),...(cfd?{}:{v:i+10})}));
const wrap=(data,now=NOW)=>({label:'',timestamp:now,data});
const catalog=()=>wrap([{symbol:'USIDX',symbol_desc:'US Dollar Index',status:'closed',trade_mode:'4'}]);
const contract=()=>({name:'VOLX_USDT',type:'direct',in_delisting:false,quanto_multiplier:'0.1',funding_interval:28800});
const minute=()=>wrap({list:[{t:Date.parse('2026-10-23T20:58:00Z')/1000,o:'101',h:'102',l:'100',c:'101.5'}]});
const cfdTicker=()=>wrap({status:'closed',trade_mode:'4',bid_price:'101.781',ask_price:'101.801',next_open_time:Date.parse('2026-10-26T00:00:00Z')/1000});
const ticker=()=>[{contract:'VOLX_USDT',funding_rate:'-0.005',index_price:'18.794',mark_price:'18.606',volume_24h_quote:'8876'}];
const book=()=>({current:NOW/1000,update:NOW/1000-20,bids:[{p:'18.334',s:6}],asks:[{p:'18.430',s:1}]});
function fixture(){
  let failure=0;const calls=[];
  const hub=new FeedHub({now:()=>NOW,fetcher:async(url,options)=>{
    const path=String(url);calls.push({path,options});assert.ok(path.startsWith(GATE+'/'));
    assert.equal(options.method,undefined);assert.equal(options.headers?.Authorization,undefined);
    if(failure)return {ok:false,status:failure};
    let data;if(path.endsWith('/tradfi/symbols'))data=catalog();
    else if(path.includes('/contracts/'))data=contract();
    else if(path.includes('kline_type=1d'))data=wrap({list:candles(true)});
    else if(path.includes('kline_type=1m'))data=minute();
    else if(path.includes('/USIDX/tickers'))data=cfdTicker();
    else if(path.includes('/candlesticks'))data=candles();
    else if(path.includes('/order_book'))data=book();
    else if(path.includes('/tickers'))data=ticker();
    else throw Error('Unexpected public path');
    return {ok:true,json:async()=>structuredClone(data)};
  }});
  return {hub,picker:new InstrumentPicker(hub),calls,fail:status=>{failure=status;}};
}

test('candidate search is opt-in, bounded and cannot change the 32 slots or initiate subscriptions',async()=>{
  const f=fixture(),p=sanitizePrefs({});const search=await f.picker.search('','gate');
  assert.deepEqual(search.items.map(i=>i.id).sort(),CANDIDATES.map(i=>i.id).sort());assert.equal(f.calls.length,0);assert.equal(f.hub.items.size,32);
  assert.equal((await f.picker.search('DXY','gate')).items[0].id,CFD.id);assert.equal((await f.picker.search('VIX','gate')).items[0].id,PERP.id);
  for(const i of CATALOG)assert.equal(selectedKey(p,i.id),i.id);
  for(const key of ['GATE:CFD:EURUSD','GATE:PERP:VIX_USDT','GATE:https://example.com','GATE:CFD:US10Y'])assert.equal(descriptor(key),null);
});
test('CFD calendar preserves the following session date for evening opens and rejects unknown boundaries',()=>{
  assert.equal(cfdSessionDate(OPEN/1000,NOW),'2026-10-23');
  assert.equal(cfdSessionDate((OPEN+3600000)/1000,NOW),'2026-10-23');
  assert.equal(cfdSessionDate(MIDNIGHT/1000,NOW),'2026-10-24');
  for(const t of [OPEN/1000+60,OPEN/1000+7200,NOW/1000+3600])assert.throws(()=>cfdSessionDate(t,NOW));
  const parsed=parseGateCandles(wrap({list:candles(true)}),{cfd:true,now:NOW});
  assert.equal(parsed.bars.at(-1).time,'2026-10-23');assert.equal(parsed.dailySessionOpen,OPEN);assert.ok(parsed.bars.every(b=>b.volume===null));
  assert.equal(sma(parsed.bars).at(-1).value,parsed.bars.slice(-20).reduce((s,b)=>s+b.close,0)/20);
  const rows=[parsed.bars.at(-2),{...parsed.bars.at(-1),time:'2026-10-27'}];assert.deepEqual(gaps(rows,'cfd'),['2026-10-23','2026-10-26']);
});
test('bad OHLC, future/duplicate candles, absent or fractional contract volume fail closed',()=>{
  for(const change of [r=>{r[0].h='1';},r=>{r[0].t=NOW/1000+3600;},r=>{r[1].t=r[0].t;},r=>{r[0].v='';},r=>{r[0].v='0.1';},r=>{r[0].l='0';}]){const rows=candles();change(rows);assert.throws(()=>parseGateCandles(rows,{now:NOW}));}
  const c=candles(true);c[1].t=c[0].t;assert.throws(()=>parseGateCandles(wrap({list:c}),{cfd:true,now:NOW}));
  assert.throws(()=>parseGateCandles({...wrap({list:candles(true)}),label:'ERROR'},{cfd:true,now:NOW}));
});
test('metadata validates exact identity, direct multiplier and availability',()=>{
  assert.equal(verifyGateCfd(catalog(),NOW),true);assert.equal(verifyGatePerp(contract()).multiplier,0.1);
  for(const patch of [{symbol:'USDX'},{symbol_desc:'US equity index'},{trade_mode:'0'}]){const c=catalog();Object.assign(c.data[0],patch);assert.throws(()=>verifyGateCfd(c,NOW));}
  for(const patch of [{name:'VIX_USDT'},{in_delisting:true},{quanto_multiplier:'1'},{type:'inverse'}])assert.throws(()=>verifyGatePerp({...contract(),...patch}));
});
test('source evidence separates server response, minute start, book update and unknown underlying time',()=>{
  const c=cfdEvidence(cfdTicker(),minute(),NOW),p=perpEvidence(ticker(),book(),NOW);
  assert.notEqual(c.sourceTime,c.providerServerTime);assert.match(c.sourceTimeKind,/not an underlying/);assert.match(p.sourceTimeKind,/not last trade/);assert.equal(p.fundingRate,-0.005);
  assert.throws(()=>cfdEvidence(cfdTicker(),{...minute(),timestamp:NOW-180001},NOW));
  assert.throws(()=>cfdEvidence(wrap({...cfdTicker().data,bid_price:'200'}),minute(),NOW));
  assert.throws(()=>perpEvidence([{...ticker()[0],contract:'BTC_USDT'}],book(),NOW));
  assert.throws(()=>perpEvidence(ticker(),{...book(),update:NOW/1000+1},NOW));
});
test('market-closed freshness does not confuse a fresh HTTP response with source activity',()=>{
  const c={...cfdEvidence(cfdTicker(),minute(),NOW),dailySessionOpen:OPEN,lastFetched:NOW,connection:'connected',status:'candidate-polling'};
  assert.equal(gateStatus(c,NOW),'session-closed');assert.equal(gateStatus({...c,nextOpen:0},NOW),'calendar-unknown');
  assert.equal(gateStatus({...c,lastFetched:NOW-180001},NOW),'stale');assert.equal(gateStatus({...c,sourceTime:NOW-9*DAY},NOW),'stale');
  const open={...c,marketStatus:'open',sourceTime:NOW-60000,dailySessionOpen:NOW-15*3600000};assert.equal(gateStatus(open,NOW),'candidate-polling');assert.equal(gateStatus({...open,sourceTime:NOW-300001},NOW),'stale');
  assert.equal(gateStatus({...open,connection:'disconnected',status:'reconnecting'},NOW),'reconnecting');
  assert.equal(gateStatus({...open,marketStatus:'perpetual',dailySessionOpen:MIDNIGHT},NOW),'proxy-polling');
});
test('candidate prepare checks real-shaped data, preserves reference histories and caches only metadata',async()=>{
  const f=fixture();f.hub.symbols.DXY.bars=[{time:'2026-10-23',close:101.8,volume:null}];const original=structuredClone(f.hub.symbols);
  const c=await f.picker.prepare(CFD.id),p=await f.picker.prepare(PERP.id);
  assert.equal(c.data.bars.length,60);assert.equal(c.data.status,'session-closed');assert.equal(c.data.volumeUnit,null);assert.equal(p.data.bars.at(-1).volume,69);assert.equal(p.data.mode,'candidate');assert.match(p.data.sourceDelay,/Unknown/);
  for(const i of CATALOG)assert.deepEqual(f.hub.symbols[i.id],original[i.id]);
  const n=f.calls.length;await f.hub.refreshGate([CFD]);assert.equal(f.calls.length,n+3,'quotes/candles refreshed; metadata cached');
  const prev=f.calls.length;await f.picker.prepare(CFD.id);assert.equal(f.calls.length,prev,'prepared cached data keeps honest status');
});
test('outage retains candle/source identity and recovery never merges ECB/Cboe history',async()=>{
  const f=fixture();await f.picker.prepare(CFD.id);const retained=structuredClone(f.hub.symbols[CFD.id].bars);
  f.fail(503);assert.equal(await f.hub.refreshGate(),false);assert.equal(f.hub.snapshot().symbols[CFD.id].status,'reconnecting');assert.deepEqual(f.hub.symbols[CFD.id].bars,retained);assert.equal(f.hub.symbols[CFD.id].fallbackId,'DXY');
  f.fail(0);assert.equal(await f.hub.refreshGate(),true);assert.equal(f.hub.snapshot().symbols[CFD.id].status,'session-closed');assert.deepEqual(f.hub.symbols[CFD.id].bars,retained);assert.equal(f.hub.symbols.DXY.bars.length,0);
});
test('an access denial stops both Gate routes and survives a seeded restart, even before history',async()=>{
  const f=fixture();f.fail(403);await assert.rejects(f.picker.prepare(CFD.id),e=>e.status===403);const n=f.calls.length;
  await f.hub.refreshGate();await assert.rejects(f.picker.prepare(PERP.id),e=>e.status===403);assert.equal(f.calls.length,n);
  const next=new FeedHub({seed:f.hub.snapshot(),now:()=>NOW,fetcher:async()=>{throw Error('Denied provider must not be retried');}});
  assert.ok(next.blockedRoutes.has('gate'));await assert.rejects(new InstrumentPicker(next).prepare(PERP.id),e=>e.status===403);assert.equal(next.symbols[CFD.id].status,'access-unavailable');
});
test('Gate polling uses 60 seconds, backs off on 429, and cannot accelerate existing polls',async()=>{
  const f=fixture(),timers=[];f.hub.schedule=(fn,ms)=>{const t={fn,ms};timers.push(t);return t;};f.hub.cancel=()=>{};f.hub.stopped=false;
  await f.picker.prepare(CFD.id);assert.deepEqual(timers.map(x=>x.ms),[60000]);f.hub.ensureGateLoop();assert.equal(timers.length,1);
  f.fail(429);await timers.at(-1).fn();assert.equal(timers.at(-1).ms,120000);assert.equal(f.hub.snapshot().symbols[CFD.id].status,'reconnecting');
  f.fail(0);await timers.at(-1).fn();assert.equal(timers.at(-1).ms,60000);f.hub.stop();
});
test('selection, cancellation, reload, undo and reference fallback preserve unrelated slots/settings',()=>{
  const initial=sanitizePrefs({active:'Indices',tabs:{Indices:{range:'6M',volume:false,ranges:{DXY:{from:1,to:30}}}},selections:{PLTR:'AAPL'}});
  const changed=changeSlot(initial,'DXY',CFD.id);assert.equal(selectedKey(initial,'DXY'),'DXY');assert.deepEqual(changed.tabs,initial.tabs);assert.equal(selectedKey(changed,'PLTR'),'AAPL');
  const memory=new Map(),storage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)};savePrefs(storage,changed);assert.equal(selectedKey(readPrefs(storage),'DXY'),CFD.id);
  assert.equal(selectedKey(undoSlot(readPrefs(storage),'DXY'),'DXY'),'DXY');assert.equal(selectedKey(changeSlot(changed,'DXY',CFD.fallbackId),'DXY'),'DXY');
});
