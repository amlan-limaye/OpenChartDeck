import test from 'node:test';
import assert from 'node:assert/strict';
import {AlpacaIexFeed} from '../lib/alpaca.mjs';
import {OVERVIEW_IEX_SYMBOLS as originals} from '../lib/iex-symbols.mjs';
const now=Date.parse('2026-10-23T15:00:00Z');
const bar=(c=10,v=100)=>({t:'2026-10-23T04:00:00Z',o:10,h:Math.max(c,11),l:9,c,v});
const tick=()=>new Promise(r=>setImmediate(r));
function harness(symbols=originals){
  class Socket{
    static all=[];constructor(){this.handlers={};this.sent=[];Socket.all.push(this);}
    addEventListener(k,f){(this.handlers[k]??=[]).push(f);}
    emit(k,v={}){for(const f of this.handlers[k]??[])f(v);}
    message(...v){this.emit('message',{data:JSON.stringify(v)});}
    send(v){this.sent.push(JSON.parse(v));}close(){this.emit('close');}
  }
  const timeouts=[],timers={setTimeout(f,ms){const t={f,ms};timeouts.push(t);return t;},clearTimeout(t){if(t)t.cancelled=true;},setInterval(){return 1;},clearInterval(){}};
  let clock=now;const requests=[];
  const feed=new AlpacaIexFeed({key:'fixture-key',secret:'fixture-secret',symbols,now:()=>clock,WebSocketImpl:Socket,timers,fetchImpl:async url=>{
    const names=url.searchParams.get('symbols').split(',');requests.push(names);
    return {ok:true,status:200,json:async()=>({bars:Object.fromEntries(names.map(s=>[s,s==='EMPTY'?[]:[bar()]]))})};
  }});
  const authenticate=async()=>{const ws=Socket.all.at(-1);ws.emit('open');ws.message({T:'success',msg:'authenticated'},{T:'subscription',dailyBars:[...feed.symbols]});await tick();return ws;};
  return {feed,Socket,timeouts,requests,authenticate,setNow:v=>clock=v};
}
test('dynamic symbol validates history and waits for stream acknowledgement without reconnecting',async t=>{
  const h=harness();t.after(()=>h.feed.stop());h.feed.start();const ws=await h.authenticate();h.setNow(now+240000);
  const p=h.feed.addSymbol('TSLA');await tick();assert.equal(h.feed.state().symbols.TSLA,undefined);assert.deepEqual(ws.sent.at(-1),{action:'subscribe',dailyBars:['TSLA']});
  ws.message({T:'subscription',dailyBars:[...originals,'TSLA']});await p;
  assert.equal(h.feed.symbols.length,15);assert.equal(h.feed.state().symbols.TSLA.status,'waiting');assert.equal(h.feed.state().symbols.TSLA.lastReceived,null);
  assert.equal(h.Socket.all.length,1);assert.equal(h.requests.length,2);assert.ok(!JSON.stringify(h.feed.state()).includes('fixture-secret'));
  ws.message({T:'subscription',dailyBars:[...originals,'TSLA']});await tick();assert.equal(h.requests.length,2,'repeated ACK must not reload all history');
  ws.message({...bar(12,120),T:'d',S:'TSLA'},{...bar(13,180),T:'d',S:'TSLA'});assert.equal(h.feed.bars.TSLA.at(-1).volume,180);assert.equal(h.feed.state().symbols.TSLA.status,'live');
  const second=h.feed.addSymbol('NVDA');await tick();ws.message({T:'subscription',dailyBars:[...originals,'TSLA','NVDA']});await second;assert.equal(h.Socket.all.length,1);
});
test('new-symbol stream updates during validation acknowledgement preserve cumulative OHLCV',async t=>{
  const h=harness();t.after(()=>h.feed.stop());h.feed.start();const ws=await h.authenticate();const p=h.feed.addSymbol('TSLA');await tick();
  ws.message({...bar(12,170),T:'d',S:'TSLA'},{T:'subscription',dailyBars:[...originals,'TSLA']});await p;assert.equal(h.feed.bars.TSLA.at(-1).volume,170);assert.equal(h.feed.state().symbols.TSLA.status,'live');
});
test('invalid, empty, concurrent, timeout and provider rejection preserve original subscriptions',async t=>{
  const h=harness();t.after(()=>h.feed.stop());h.feed.start();const ws=await h.authenticate();const originalBars=structuredClone(h.feed.bars);
  await assert.rejects(h.feed.addSymbol('https://evil'),{code:'input'});await assert.rejects(h.feed.addSymbol('EMPTY'),{code:'no-data'});
  const p=h.feed.addSymbol('TSLA'),duplicate=h.feed.addSymbol('TSLA');const rejected=assert.rejects(p,{code:'unavailable'}),duplicateRejected=assert.rejects(duplicate,{code:'unavailable'});await tick();await assert.rejects(h.feed.addSymbol('NVDA'),{code:'busy'});
  h.timeouts.findLast(x=>x.ms===10000&&!x.cancelled).f();await rejected;await duplicateRejected;
  const p2=h.feed.addSymbol('TSLA');const rejected2=assert.rejects(p2,{code:'subscription'});await tick();ws.message({T:'error',code:405,msg:'never echo provider body'});await rejected2;
  assert.deepEqual(h.feed.symbols,originals);assert.deepEqual(h.feed.bars,originalBars);assert.equal(h.feed.connection,'connected');assert.equal(h.Socket.all.length,1);
});
test('disconnect during addition never promotes it; reconnect resubscribes successful additions',async t=>{
  const h=harness();t.after(()=>h.feed.stop());h.feed.start();let ws=await h.authenticate();let p=h.feed.addSymbol('TSLA');await tick();ws.message({T:'subscription',dailyBars:[...originals,'TSLA']});await p;
  p=h.feed.addSymbol('NVDA');const rejected=assert.rejects(p,{code:'unavailable'});await tick();ws.close();await rejected;
  assert.equal(h.feed.state().connection,'reconnecting');assert.equal(h.feed.symbols.includes('NVDA'),false);assert.equal(h.feed.bars.TSLA.length,1);
  h.timeouts.findLast(x=>!x.cancelled).f();ws=await h.authenticate();assert.ok(ws.sent[1].dailyBars.includes('TSLA'));assert.equal(h.feed.connection,'connected');
});
test('full stream preserves all leased/original stocks and evicts only an expired added stock',async t=>{
  const all=[...originals,...Array.from({length:16},(_,i)=>'TEST'+i)],h=harness(all);t.after(()=>h.feed.stop());h.feed.start();const ws=await h.authenticate();
  await assert.rejects(h.feed.addSymbol('TSLA',all),{code:'capacity'});assert.equal(h.feed.symbols.length,30);
  const retain=all.filter(s=>s!=='TEST0'),p=h.feed.addSymbol('TSLA',retain);await tick();assert.deepEqual(ws.sent.at(-2),{action:'unsubscribe',dailyBars:['TEST0']});ws.message({T:'subscription',dailyBars:[...retain,'TSLA']});await p;
  assert.equal(h.feed.symbols.length,30);assert.ok(originals.every(s=>h.feed.symbols.includes(s)));assert.equal(h.feed.symbols.includes('TEST0'),false);
});
