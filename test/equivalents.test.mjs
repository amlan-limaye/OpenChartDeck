import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDxy,parseEcbDxy,ECB_URL,parseVix,parseTreasury,normalizePoints,verifyXyz,DXY_WEIGHTS} from '../lib/equivalents.mjs';
import {FeedHub} from '../lib/feeds.mjs';
import {BY_ID,CATALOG} from '../public/catalog.mjs';
import {sma,validBar,timelineFor,sanitizePrefs} from '../public/core.mjs';
import {referenceDay,referenceStatus,expectedReferenceDate,externalReferenceSession} from '../public/reference.mjs';
const now=Date.parse('2026-10-24T14:00:00Z');
const rates=(date='2026-10-23')=>Object.keys(DXY_WEIGHTS).map(quote=>({date,base:'USD',quote,rate:1}));
const xml=(date='2026-10-23',value='5.00')=>`<feed><entry><m:properties><d:NEW_DATE m:type="Edm.DateTime">${date}T00:00:00</d:NEW_DATE><d:BC_10YEAR m:type="Edm.Double">${value}</d:BC_10YEAR></m:properties></entry></feed>`;
const csv='DATE,OPEN,HIGH,LOW,CLOSE\n10/22/2026,18,20,17,19\n10/23/2026,19,21,18,20\n';
const ecb=(date='2026-10-23',rates={USD:1.1,JPY:170,GBP:.85,CAD:1.5,SEK:11,CHF:.94})=>`<gesmes:Envelope><Cube><Cube time='${date}'>${Object.entries(rates).map(([q,r])=>`<Cube currency='${q}' rate='${r}'/>`).join('')}</Cube></Cube></gesmes:Envelope>`;
test('official ECB EUR-base XML yields the same USD-base basket and rejects mixed/invalid inputs',()=>{
  const p=parseEcbDxy(ecb(),now),r={EUR:1/1.1,JPY:170/1.1,GBP:.85/1.1,CAD:1.5/1.1,SEK:11/1.1,CHF:.94/1.1};
  assert.deepEqual(p,parseDxy(Object.entries(r).map(([quote,rate])=>({date:'2026-10-23',base:'USD',quote,rate})),now));
  for(const invalid of [ecb().replace("currency='CHF'","currency='GBP'"),ecb().replace("rate='1.1'","rate='0'"),ecb('2026-10-25'),ecb().replace('</gesmes:Envelope>',''),'<!DOCTYPE a>'+ecb(),ecb('2026-10-23',{USD:1.1,JPY:170})])assert.throws(()=>parseEcbDxy(invalid,now));
});
test('direct ECB repair retains old history, replaces overlapping fixings and preserves SMA without OHLCV fabrication',async()=>{
  let good=true;const calls=[],hub=new FeedHub({now:()=>now,fetcher:async url=>{calls.push(String(url));if(!good)throw Error('Fixture outage');return{ok:true,status:200,text:async()=>ecb()};}});
  hub.symbols.DXY.bars=Array.from({length:23},(_,i)=>({time:`2026-10-${String(i+1).padStart(2,'0')}`,close:i+1,volume:null}));
  assert.equal(await hub.refreshReference('ecb'),true);assert.deepEqual(calls,[ECB_URL]);assert.equal(hub.symbols.DXY.bars.length,23);assert.equal(hub.symbols.DXY.bars[0].close,1);
  const tail=hub.symbols.DXY.bars.slice(-20);assert.equal(sma(hub.symbols.DXY.bars).at(-1).value,tail.reduce((s,b)=>s+b.close,0)/20);assert.equal(hub.symbols.DXY.pollMs,3600000);assert.equal(hub.symbols.DXY.volumeUnit,null);assert.equal(hub.snapshot().symbols.DXY.status,'daily-reference');
  const retained=structuredClone(hub.symbols.DXY.bars);good=false;await hub.refreshReference('ecb');assert.deepEqual(hub.symbols.DXY.bars,retained);assert.equal(hub.snapshot().symbols.DXY.status,'reconnecting');
});
test('DXY uses six same-date currencies and correct USD-base exponent direction',()=>{
  assert.equal(parseDxy(rates(),now)[0].close,50.14348112);
  for(const [quote,weight]of Object.entries(DXY_WEIGHTS)){const rows=rates().map(r=>({...r,rate:r.quote===quote?2:1}));assert.ok(Math.abs(parseDxy(rows,now)[0].close-50.14348112*2**weight)<1e-10);}
  assert.equal(parseDxy(rates().slice(1),now).length,0);assert.throws(()=>parseDxy([...rates(),rates()[0]],now));assert.throws(()=>parseDxy(rates().map(r=>({...r,base:'EUR'})),now));assert.throws(()=>parseDxy(rates('2026-10-25'),now));
});
test('reference points never invent OHLC or volume; SMA uses received observations',()=>{
  const rows=Array.from({length:23},(_,i)=>({time:`2026-10-${String(i+1).padStart(2,'0')}`,close:i+1,volume:null}));const p=normalizePoints(rows);assert.deepEqual(sma(p).map(x=>x.value),[10.5,11.5,12.5,13.5]);assert.throws(()=>normalizePoints([{...rows[0],open:1}]));assert.throws(()=>normalizePoints([{...rows[0],volume:0}]));assert.throws(()=>validBar(rows[0]));
});
test('Treasury parses percent yield and refuses wrong schema, entities and future observations',()=>{
  assert.deepEqual(parseTreasury(xml(),now),[{time:'2026-10-23',close:5,volume:null}]);assert.throws(()=>parseTreasury(xml().replaceAll('BC_10YEAR','BC_2YEAR'),now));assert.throws(()=>parseTreasury('<!DOCTYPE x>'+xml(),now));assert.throws(()=>parseTreasury(xml('2026-10-25'),now));assert.throws(()=>parseTreasury(xml('2026-10-23',''),now));
});
test('Cboe VIX preserves true OHLC with null volume; malformed downloads fail',()=>{
  const rows=parseVix(csv,now);assert.equal(rows[1].close,20);assert.equal(rows[1].volume,null);assert.throws(()=>validBar(rows[1]));assert.deepEqual(validBar(rows[1],{noVolume:true}),rows[1]);assert.throws(()=>parseVix(csv.replace('HIGH','HI'),now));assert.throws(()=>parseVix(csv.replace(',21,18,20',',18,18,20'),now));assert.throws(()=>parseVix(csv.replace('10/23/2026','10/25/2026'),now));
});
test('reference calendars omit actual holidays/weekends and keep missing sessions empty',()=>{
  assert.equal(referenceDay('2026-05-01','target'),false);assert.equal(referenceDay('2026-04-06','target'),false);assert.equal(referenceDay('2026-10-12','treasury'),false);assert.equal(referenceDay('2026-10-12','cboe'),true);assert.equal(referenceDay('2026-10-24','target'),false);
  const rows=[{time:'2026-10-22'},{time:'2026-10-26'}];assert.deepEqual(timelineFor(rows,'reference','target'),['2026-10-22','2026-10-23','2026-10-26']);
});
test('daily freshness distinguishes publication schedule, frozen history, failed HTTP and old checks',()=>{
  for(const calendar of ['target','treasury','cboe']){const d={calendar,pollMs:3600000,lastFetched:now,connection:'connected',bars:[{time:'2026-10-23'}],status:'daily-reference'};assert.equal(expectedReferenceDate(calendar,now),'2026-10-23');assert.equal(referenceStatus(d,now),'daily-reference');assert.equal(referenceStatus({...d,bars:[{time:'2026-10-21'}]},now),'stale');assert.equal(referenceStatus(d,now+10800001),'stale');assert.equal(referenceStatus({...d,connection:'disconnected',status:'reconnecting'},now),'reconnecting');}
  assert.equal(expectedReferenceDate('target',Date.parse('2026-10-26T08:00:00Z')),'2026-10-23');assert.equal(expectedReferenceDate('target',Date.parse('2026-10-26T20:00:00Z')),'2026-10-26');
});
test('exact public perpetual identity rejects delisted and ambiguous markets',()=>{
  assert.equal(verifyXyz({universe:[{name:'xyz:JPY'}]},'xyz:JPY'),true);assert.equal(verifyXyz({universe:[{name:'xyz:JPY',isDelisted:true}]},'xyz:JPY'),false);assert.equal(verifyXyz({universe:[{name:'xyz:JPY'},{name:'xyz:JPY'}]},'xyz:JPY'),false);assert.equal(verifyXyz({universe:[{name:'xyz:DXY'}]},'xyz:JPY'),false);
});
test('equivalent metadata exposes originals, units and meaningful differences; saved IDs remain stable',()=>{
  const extra=CATALOG.filter(i=>['xyz','ecb','treasury','cboe'].includes(i.route));assert.equal(extra.length,9);assert.ok(extra.every(i=>i.original&&i.quoteUnit&&i.difference));assert.equal(BY_ID.USDJPY.quoteUnit,'JPY per USD');assert.equal(BY_ID.OILUSD.pair,'xyz:CL');assert.match(BY_ID.KOSPI.difference,/Narrower/);assert.match(BY_ID['GC1!'].difference,/no GC contract roll/);assert.equal(sanitizePrefs({}).tabs.Gold.order[0],'GC1!');for(const item of extra.filter(i=>i.route==='xyz'))assert.equal(externalReferenceSession(item,now).externalClosed,true);
});
test('daily provider failure retains bars, recovery updates data, denial prevents repeated requests',async()=>{
  let status=200,payload=csv,requests=0;const hub=new FeedHub({now:()=>now,fetcher:async()=>{requests++;return{ok:status===200,status,text:async()=>payload};}});
  assert.equal(await hub.refreshReference('cboe'),true);assert.equal(hub.snapshot().symbols.VIX.status,'daily-reference');status=500;assert.equal(await hub.refreshReference('cboe'),false);assert.equal(hub.symbols.VIX.bars.length,2);assert.equal(hub.snapshot().symbols.VIX.status,'reconnecting');status=200;payload=csv.replace(',21,18,20',',21,18,20.5');await hub.refreshReference('cboe');assert.equal(hub.symbols.VIX.bars.at(-1).close,20.5);assert.equal(hub.symbols.VIX.bars.at(-1).volume,null);status=403;await hub.refreshReference('cboe');const n=requests;await hub.refreshReference('cboe');assert.equal(requests,n);assert.equal(hub.snapshot().symbols.VIX.status,'access-unavailable');
});
test('perpetual failure and reconnection keep previous history without changing source',async()=>{
  let failed=false;const items=CATALOG.filter(i=>i.route==='xyz');const hub=new FeedHub({now:()=>now,fetcher:async(_,opt)=>{if(failed)throw Error();const body=JSON.parse(opt.body);return{ok:true,json:async()=>body.type==='meta'?{universe:items.map(i=>({name:i.pair}))}:[{s:body.req.coin,i:'1d',t:Date.parse('2026-10-24'),T:Date.parse('2026-10-25')-1,o:'10',h:'11',l:'9',c:'10.5',v:'23.7'}]};}});
  assert.equal(await hub.refreshXyz(),true);failed=true;await hub.refreshXyz();assert.ok(items.every(i=>hub.symbols[i.id].bars.length===1&&hub.symbols[i.id].status==='reconnecting'));failed=false;await hub.refreshXyz();assert.ok(items.every(i=>hub.snapshot().symbols[i.id].status==='polling'&&hub.symbols[i.id].providerSymbol===i.pair));
});
