import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchHistory, AlpacaIexFeed, retryDelay, STREAM_URL } from '../lib/alpaca.mjs';
import { SYMBOLS } from '../public/iex-core.mjs';
const now=Date.parse('2026-10-23T15:00:00Z');
const apiBar=(day='22',c=10,v=100)=>({t:`2026-10-${day}T04:00:00Z`,o:10,h:Math.max(11,c),l:9,c,v});
const ok=payload=>({ok:true,status:200,json:async()=>payload});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('History uses only IEX, daily raw bars, authorization headers, and consumes every page',async()=>{
  const calls=[];const replies=[{bars:{AAPL:[apiBar()]},next_page_token:'second'},{bars:{BOT:[apiBar()]},next_page_token:null}];
  const result=await fetchHistory({key:'test-key',secret:'test-secret',now,fetchImpl:async(url,options)=>{calls.push({url,options});return ok(replies.shift());}});
  assert.equal(calls.length,2);assert.equal(calls[0].url.searchParams.get('feed'),'iex');assert.equal(calls[0].url.searchParams.get('timeframe'),'1Day');assert.equal(calls[0].url.searchParams.get('adjustment'),'raw');assert.equal(calls[1].url.searchParams.get('page_token'),'second');assert.equal(calls[0].options.headers['APCA-API-SECRET-KEY'],'test-secret');assert.equal(calls[0].url.origin,'https://data.alpaca.markets');
  assert.equal(result.AAPL.length,1);assert.equal(result.BOT.length,1);assert.deepEqual(result.DRAM,[]);
});
test('Auth, rate limit, network, malformed and incomplete history fail without exposing provider secrets',async()=>{
  for(const [status,code]of [[401,'auth'],[403,'auth'],[429,'rate-limit'],[500,'network']]){
    await assert.rejects(fetchHistory({key:'sensitive',secret:'sensitive',now,fetchImpl:async()=>({ok:false,status,text:async()=>'sensitive'})}),error=>error.code===code&&!error.message.includes('sensitive'));
  }
  await assert.rejects(fetchHistory({key:'k',secret:'s',now,fetchImpl:async()=>ok({bars:{AAPL:[{...apiBar(),v:-1}]}})}),{code:'data'});
  await assert.rejects(fetchHistory({key:'k',secret:'s',now,fetchImpl:async()=>ok({bars:{},next_page_token:'repeated'})}),{code:'data'});
  await assert.rejects(fetchHistory({key:'k',secret:'s',now,fetchImpl:async()=>{throw Error('sensitive');}}),{code:'network'});
});
function harness(){
  class Socket{
    static instances=[];
    constructor(url){this.url=url;this.listeners={};this.sent=[];Socket.instances.push(this);}
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
    emit(type,data){for(const fn of this.listeners[type]??[])fn(data);}
    message(data){this.emit('message',{data:JSON.stringify(data)});}
    send(text){this.sent.push(JSON.parse(text));}
    close(){this.emit('close',{});}
  }
  const timeouts=[],intervals=[];
  const timers={setTimeout(fn,ms){const task={fn,ms};timeouts.push(task);return task;},clearTimeout(task){if(task)task.cancelled=true;},setInterval(fn,ms){const task={fn,ms};intervals.push(task);return task;},clearInterval(task){if(task)task.cancelled=true;}};
  let clock=now,fetchCount=0;
  const feed=new AlpacaIexFeed({key:'test-key',secret:'test-secret',now:()=>clock,timers,WebSocketImpl:Socket,fetchImpl:async()=>{fetchCount++;return ok({bars:Object.fromEntries(SYMBOLS.map(s=>[s,[apiBar()]]))});}});
  const authenticate=async()=>{const ws=Socket.instances.at(-1);ws.emit('open',{});ws.message([{T:'success',msg:'authenticated'}]);ws.message([{T:'subscription',dailyBars:SYMBOLS}]);await tick();return ws;};
  return{feed,Socket,timeouts,intervals,authenticate,setNow:x=>clock=x,fetchCount:()=>fetchCount};
}
test('Stream authenticates once, subscribes to exactly eight daily bars, hydrates, and replaces cumulative volume',async()=>{
  const h=harness();h.feed.start();const ws=await h.authenticate();assert.equal(ws.url,STREAM_URL);assert.deepEqual(ws.sent[1],{action:'subscribe',dailyBars:SYMBOLS});assert.equal(h.feed.state().status,'waiting');
  ws.message([{...apiBar('23',12,200),T:'d',S:'AAPL'}]);ws.message([{...apiBar('23',13,230),T:'d',S:'AAPL'}]);
  assert.equal(h.feed.bars.AAPL.at(-1).volume,230);assert.equal(h.feed.bars.AAPL.length,2);assert.equal(h.feed.state().symbols.AAPL.status,'live');assert.equal(h.feed.state().symbols.BOT.status,'waiting');assert.ok(!JSON.stringify(h.feed.state()).includes('test-secret'));h.feed.stop();
});
test('Disconnect preserves last good data and reconnects with backfill before live status',async()=>{
  const h=harness();h.feed.start();const ws=await h.authenticate();ws.message([{...apiBar('23',12,200),T:'d',S:'AAPL'}]);ws.emit('close',{});
  assert.equal(h.feed.state().connection,'reconnecting');assert.equal(h.feed.bars.AAPL.at(-1).volume,200);
  const retry=h.timeouts.filter(t=>!t.cancelled).at(-1);assert.equal(retry.ms,1000);retry.fn();const next=await h.authenticate();assert.equal(h.fetchCount(),2);assert.equal(h.feed.state().status,'waiting');
  next.message([{...apiBar('23',14,300),T:'d',S:'AAPL'}]);assert.equal(h.feed.state().status,'live');assert.equal(h.feed.bars.AAPL.at(-1).volume,300);h.feed.stop();
});
test('Messages arriving during backfill are retained; old-session correction does not claim a live symbol',async()=>{
  const h=harness();let resolve;h.feed.fetchImpl=()=>new Promise(r=>resolve=r);h.feed.start();const ws=h.Socket.instances.at(-1);ws.emit('open',{});ws.message([{T:'success',msg:'authenticated'},{T:'subscription',dailyBars:SYMBOLS}]);
  ws.message([{...apiBar('23',13,230),T:'d',S:'AAPL'}]);resolve(ok({bars:{AAPL:[apiBar()]}}));await tick();assert.equal(h.feed.bars.AAPL.at(-1).volume,230);
  ws.message([{...apiBar('21',11,150),T:'d',S:'BOT'}]);assert.equal(h.feed.state().symbols.BOT.status,'waiting');h.feed.stop();
});
test('Stale stream initiates reconnect; auth rejection stops retries; retry interval is bounded',async()=>{
  const h=harness();h.feed.start();await h.authenticate();h.setNow(now+181000);assert.equal(h.feed.state().status,'stale');h.intervals[0].fn();assert.equal(h.feed.state().connection,'reconnecting');h.feed.stop();
  const a=harness();a.feed.start();a.Socket.instances[0].message([{T:'error',code:402,msg:'sensitive provider text'}]);assert.equal(a.feed.state().connection,'access-required');assert.equal(a.timeouts.filter(t=>!t.cancelled).length,0);assert.ok(!a.feed.state().message.includes('sensitive'));a.feed.stop();
  assert.equal(retryDelay(0),1000);assert.equal(retryDelay(10),30000);
});
test('Missing credentials make no network calls',()=>{const h=harness();h.feed.key=undefined;h.feed.start();assert.equal(h.feed.state().status,'setup-required');assert.equal(h.Socket.instances.length,0);assert.equal(h.fetchCount(),0);h.feed.stop();});
