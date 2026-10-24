import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRuntime,parseOptions} from '../server.mjs';
import {FeedHub} from '../lib/feeds.mjs';
import {OVERVIEW_IEX_SYMBOLS} from '../lib/iex-symbols.mjs';
test('portable CLI accepts only local port and explicit IEX options',()=>{
 assert.deepEqual(parseOptions([]),{port:4175,iex:false,publicData:false,demo:true,cboe:false});assert.deepEqual(parseOptions(['--iex','--port','4180']),{port:4180,iex:true,publicData:true,demo:false,cboe:false});
 for(const args of [['--host','0.0.0.0'],['--port','0'],['--port','65536'],['--port','4180oops'],['--secret','DUMMY']])assert.throws(()=>parseOptions(args));
});
test('public-only mode makes no IEX requests or implicit connection to another process',async()=>{
 let calls=0;const hub=new FeedHub({fetcher:async()=>{calls++;throw Error('Unexpected network');}});
 assert.equal(await hub.refreshIex(),true);assert.equal(calls,0);
 for(const symbol of OVERVIEW_IEX_SYMBOLS){assert.equal(hub.snapshot().symbols[symbol].status,'setup-required');assert.equal(hub.snapshot().symbols[symbol].bars.length,0);}hub.stop();
});
test('a configured adapter failure reports reconnecting for all fourteen empty histories',async()=>{
 const hub=new FeedHub({iexState:()=>{throw Error('synthetic failure');}});
 assert.equal(await hub.refreshIex(),false);
 for(const symbol of OVERVIEW_IEX_SYMBOLS){const data=hub.snapshot().symbols[symbol];assert.equal(data.status,'reconnecting');assert.equal(data.connection,'disconnected');assert.equal(data.bars.length,0);}hub.stop();
});
test('one-process runtime connects fourteen sanitized IEX histories and preserves reconnect state',async t=>{
 const now=Date.parse('2026-10-24T07:00:00Z'),bar={time:'2026-10-23',open:10,high:12,low:9,close:11,volume:20};
 const source=new EventEmitter();let starts=0,stops=0,connection='connected';
 Object.assign(source,{start(){starts++;this.emit('state');},stop(){stops++;},state:()=>({mode:'live',feed:'IEX',connection,status:connection==='connected'?'session-closed':'reconnecting',serverTime:now,symbols:Object.fromEntries(OVERVIEW_IEX_SYMBOLS.map(s=>[s,{bars:[bar],status:connection==='connected'?'session-closed':'reconnecting'}]))})});
 const hub=new FeedHub({now:()=>now,iexState:()=>source.state()});hub.refreshBinance=hub.refreshHyperliquid=hub.refreshXyz=hub.refreshReference=async()=>true;
 const app=createRuntime({iexFeed:source,hub});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());app.start();await new Promise(setImmediate);
 const origin=`http://127.0.0.1:${app.server.address().port}`,read=async()=>await(await fetch(origin+'/api/state')).json();
 let snapshot=await read();assert.equal(starts,1);assert.equal(Object.values(snapshot.symbols).filter(s=>s.bars.length).length,14);
 for(const s of OVERVIEW_IEX_SYMBOLS){assert.equal(snapshot.symbols[s].status,'session-closed');assert.deepEqual(snapshot.symbols[s].bars,[bar]);}
 connection='reconnecting';source.emit('state');await new Promise(setImmediate);snapshot=await read();assert.equal(snapshot.symbols.PLTR.status,'reconnecting');assert.equal(snapshot.symbols.PLTR.bars.length,1);
 connection='connected';source.emit('state');await new Promise(setImmediate);assert.equal((await read()).symbols.PLTR.status,'session-closed');
 assert.ok(!JSON.stringify(snapshot).includes('APCA_API'));assert.equal(stops,0);
});
