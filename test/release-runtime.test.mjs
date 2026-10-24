import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRuntime,parseOptions} from '../server.mjs';
import {createDemoFeed,syntheticBars} from '../lib/demo.mjs';
import {FeedHub} from '../lib/feeds.mjs';
import {CATALOG,descriptor} from '../public/catalog.mjs';
import {sma} from '../public/core.mjs';

test('default launch is synthetic; public and restricted-content modes require explicit flags',()=>{
  assert.equal(parseOptions([]).demo,true);
  assert.equal(parseOptions(['--public']).demo,false);
  assert.equal(parseOptions(['--iex','--cboe']).cboe,true);
  for(const args of [['--cboe'],['--demo','--public'],['--demo','--iex']])assert.throws(()=>parseOptions(args));
});
test('demo is deterministic, conspicuously labelled and cannot request real data',async()=>{
  const feed=createDemoFeed();feed.start();const state=feed.snapshot();
  assert.equal(state.demo,true);assert.equal(state.symbols['IEX:TSLA'].mode,'demo');
  for(const item of CATALOG){const d=state.symbols[item.id];assert.ok(d.bars.length>=100);assert.equal(d.status,'demo');assert.equal(d.feed,'Synthetic demo');assert.equal(d.volumeUnit,item.volumeUnit);assert.equal(sma(d.bars).length,d.bars.length-19);}
  assert.deepEqual(syntheticBars(CATALOG[0]),syntheticBars(CATALOG[0]));
  await assert.rejects(feed.json('https://example.invalid'),/Demo never/);feed.stop();
});
test('Cboe retrieval stays off without the explicit content-rights option',async()=>{
  let calls=0;const hub=new FeedHub({cboeEnabled:false,fetcher:async()=>{calls++;throw Error('Unexpected network');}});
  assert.equal(await hub.refreshReference('cboe'),true);assert.equal(calls,0);
  assert.equal(hub.snapshot().symbols.VIX.status,'setup-required');
});
test('an unavailable configured IEX adapter marks all empty stock slots disconnected',async()=>{
  const hub=new FeedHub({iexState:()=>{throw Error('adapter unavailable');}});
  assert.equal(await hub.refreshIex(),false);
  for(const item of CATALOG.filter(i=>i.route==='iex')){const data=hub.snapshot().symbols[item.id];assert.equal(data.status,'reconnecting',item.id);assert.equal(data.connection,'disconnected',item.id);assert.equal(data.bars.length,0);}
});
test('protected picker validates a new stock through the in-memory adapter and retains existing charts',async t=>{
  const symbols={AAPL:{bars:syntheticBars(descriptor('AAPL')).slice(-30),status:'session-closed'}};
  const source=new EventEmitter();let calls=0;
  Object.assign(source,{start(){},stop(){},state:()=>({mode:'live',feed:'IEX',connection:'connected',serverTime:Date.now(),symbols}),
    async addSymbol(symbol,retain){calls++;assert.ok(retain.includes('AAPL'));if(symbol==='EMPTY'){const e=Error('No history');e.code='no-data';throw e;}symbols[symbol]={bars:syntheticBars(descriptor('IEX:'+symbol)).slice(-30),status:'session-closed'};}});
  const app=createRuntime({iexFeed:source});t.after(()=>app.close());await app.feed.refreshIex();
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${app.server.address().port}`;
  const post=key=>fetch(origin+'/api/instruments/prepare',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({key})});
  const before=structuredClone(app.feed.symbols.AAPL);
  const r=await post('IEX:TSLA');assert.equal(r.status,200);const d=await r.json();assert.equal(d.pending,false);assert.equal(d.data.bars.length,30);assert.equal(d.data.feed,'IEX');assert.equal(calls,1);
  assert.equal((await post('IEX:TSLA')).status,200);assert.equal(calls,1);
  assert.equal((await post('IEX:EMPTY')).status,404);assert.equal(app.feed.symbols['IEX:EMPTY'],undefined);
  assert.deepEqual(app.feed.symbols.AAPL.bars,before.bars);
  assert.ok(!JSON.stringify(await(await fetch(origin+'/api/state')).json()).includes('APCA_API'));
});
