import test from 'node:test';
import assert from 'node:assert/strict';
import {AlpacaIexFeed,fetchHistory} from '../lib/alpaca.mjs';
import {OVERVIEW_IEX_SYMBOLS,checkedSymbols} from '../lib/iex-symbols.mjs';
import {SYMBOLS} from '../public/iex-core.mjs';
import {applyBridge} from '../lib/feeds.mjs';
const now=Date.parse('2026-10-24T07:00:00Z'),bar={t:'2026-10-23T04:00:00Z',o:10,h:12,l:9,c:11,v:50};
const tick=()=>new Promise(setImmediate);
const ok=bars=>({ok:true,status:200,json:async()=>({bars})});
class Socket{
  constructor(url){this.url=url;this.listeners={};this.sent=[];Socket.instances.push(this);}
  static instances=[];
  addEventListener(k,f){(this.listeners[k]??=[]).push(f);}
  emit(k,e){for(const f of this.listeners[k]??[])f(e);}
  message(m){this.emit('message',{data:JSON.stringify(m)});}
  send(s){this.sent.push(JSON.parse(s));}
  close(){this.emit('close',{});}
}
const timers={setTimeout:()=>({}),clearTimeout:()=>{},setInterval:()=>({}),clearInterval:()=>{}};
test('expanded universe contains only the original eight and exact six additions',()=>{
  assert.deepEqual(OVERVIEW_IEX_SYMBOLS,[...SYMBOLS,'PLTR','GDX','HOOD','IGV','SPCX','ARKG']);assert.equal(OVERVIEW_IEX_SYMBOLS.length,14);assert.deepEqual(checkedSymbols(),SYMBOLS);
  for(const input of [[],['AAPL','AAPL'],['bad symbol'],'*'])assert.throws(()=>checkedSymbols(input));
});
test('fourteen symbols use one authenticated socket and one exact IEX history request',async()=>{
  Socket.instances=[];const requests=[];
  const feed=new AlpacaIexFeed({key:'DUMMY_KEY',secret:'DUMMY_SECRET',symbols:OVERVIEW_IEX_SYMBOLS,now:()=>now,timers,WebSocketImpl:Socket,fetchImpl:async(url,opts)=>{requests.push({url,opts});return ok(Object.fromEntries(OVERVIEW_IEX_SYMBOLS.map(s=>[s,[bar]])));}});
  feed.start();const ws=Socket.instances[0];ws.emit('open',{});ws.message([{T:'success',msg:'authenticated'}]);
  assert.deepEqual(ws.sent[1],{action:'subscribe',dailyBars:OVERVIEW_IEX_SYMBOLS});assert.equal(Socket.instances.length,1);
  ws.message([{T:'subscription',dailyBars:SYMBOLS}]);await tick();assert.equal(requests.length,0,'partial subscription must not appear connected');
  ws.message([{T:'subscription',dailyBars:OVERVIEW_IEX_SYMBOLS}]);await tick();
  assert.equal(requests.length,1);assert.equal(requests[0].url.searchParams.get('symbols'),OVERVIEW_IEX_SYMBOLS.join(','));assert.equal(requests[0].url.searchParams.get('feed'),'iex');assert.equal(requests[0].url.searchParams.get('adjustment'),'raw');
  assert.equal(feed.state().connection,'connected');assert.equal(Object.keys(feed.state().symbols).length,14);assert.ok(!JSON.stringify(feed.state()).includes('DUMMY'));
  const bridge=applyBridge(feed.state(),{},now);for(const s of OVERVIEW_IEX_SYMBOLS){assert.equal(bridge[s].bars.length,1);assert.equal(bridge[s].status,'session-closed');}
  ws.message([{T:'d',S:'PLTR',...bar,c:12,v:80},{T:'d',S:'MSFT',...bar}]);assert.equal(feed.bars.PLTR[0].volume,80);assert.equal(feed.bars.MSFT,undefined);feed.stop();
});
test('a subscribed symbol with empty history is not reported as populated or connected data',async()=>{
  Socket.instances=[];const feed=new AlpacaIexFeed({key:'DUMMY_KEY',secret:'DUMMY_SECRET',symbols:OVERVIEW_IEX_SYMBOLS,now:()=>now,timers,WebSocketImpl:Socket,fetchImpl:async()=>ok({AAPL:[bar]})});feed.start();const ws=Socket.instances[0];ws.emit('open',{});ws.message([{T:'success',msg:'authenticated'},{T:'subscription',dailyBars:OVERVIEW_IEX_SYMBOLS}]);await tick();
  assert.equal(feed.state().symbols.PLTR.status,'no-data');assert.equal(feed.state().symbols.PLTR.bars.length,0);assert.equal(feed.state().symbols.AAPL.status,'session-closed');feed.stop();
});
test('expanded auth failure is sanitized and does not fall back to another feed',async()=>{
  const calls=[];await assert.rejects(fetchHistory({symbols:OVERVIEW_IEX_SYMBOLS,key:'DUMMY_KEY',secret:'DUMMY_SECRET',fetchImpl:async(url)=>{calls.push(url);return{ok:false,status:403};}}),e=>e.code==='auth'&&!e.message.includes('DUMMY'));
  assert.equal(calls.length,1);assert.equal(calls[0].host,'data.alpaca.markets');assert.equal(calls[0].searchParams.get('feed'),'iex');
});
