import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {request} from 'node:http';
import {createApp} from '../server.mjs';
test('local server exposes read-only chart data, licenses and static assets only',async t=>{
  const feed=Object.assign(new EventEmitter(),{snapshot:()=>({version:1,symbols:{}}),stop:()=>{}}),app=createApp({feed});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${app.server.address().port}`;t.after(()=>app.close());
  for(const path of ['/','/app.mjs','/catalog.mjs','/core.mjs','/reference.mjs','/iex-core.mjs','/vendor/charts.mjs','/licenses','/LICENSE','/NOTICE'])assert.equal((await fetch(origin+path)).status,200,path);
  const state=await fetch(origin+'/api/state');assert.deepEqual(await state.json(),{version:1,symbols:{}});assert.equal(state.headers.get('cache-control'),'no-store');assert.match(state.headers.get('content-security-policy'),/connect-src 'self'/);
  assert.equal((await fetch(origin+'/api/state',{method:'POST'})).status,405,'read-only methods');assert.equal((await fetch(origin+'/api/state',{headers:{Origin:'https://example.com'}})).status,403,'cross-origin denied');
  const wrongHost=await new Promise(resolve=>{const req=request(origin+'/api/state',{headers:{Host:'example.com'}},res=>{res.resume();resolve(res.statusCode);});req.end();});assert.equal(wrongHost,403,'untrusted Host denied');
  assert.equal((await fetch(origin+'/lib/feeds.mjs')).status,404);assert.equal((await fetch(origin+'/.env')).status,404);
  const controller=new AbortController(),response=await fetch(origin+'/api/events',{signal:controller.signal});assert.equal(response.headers.get('content-type'),'text/event-stream');const reader=response.body.getReader();const chunk=await reader.read();assert.match(new TextDecoder().decode(chunk.value),/data: \{"version":1/);controller.abort();
});

test('picker validates same-origin requests, caps payloads and never turns GET into a subscription',async t=>{
  const {FeedHub}=await import('../lib/feeds.mjs');const feed=new FeedHub({fetcher:async()=>{throw Error('No external requests expected');}}),app=createApp({feed});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${app.server.address().port}`;t.after(()=>app.close());
  const search=await(await fetch(origin+'/api/instruments')).json();assert.equal(search.items.length,34);assert.equal(feed.items.size,32);assert.match(search.coverage,/No automatic/);
  const gate=await(await fetch(origin+'/api/instruments?provider=gate')).json();assert.equal(gate.items.length,2);assert.equal(feed.items.size,32);
  assert.equal((await fetch(origin+'/selection.mjs')).status,200);
  const path=origin+'/api/instruments/prepare',post=(body,headers={})=>fetch(path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await fetch(path,{method:'POST',body:'{}'})).status,403);assert.equal((await post({key:'IEX:TSLA'},{Origin:'https://example.com'})).status,403);assert.equal((await fetch(path)).status,404);
  assert.equal((await post({key:'https://evil.test'})).status,400);assert.equal((await post({key:'A'.repeat(5000)})).status,413);
  const prepared=await(await post({key:'IEX:TSLA'})).json();assert.equal(prepared.pending,true);assert.equal(prepared.data,null);assert.equal(feed.items.size,32);
  assert.equal((await fetch(origin+'/api/instruments?q='+('A'.repeat(49)))).status,400);
});
