import test from 'node:test';
import assert from 'node:assert/strict';
import { SYMBOLS, sessionDate, normalizeBars, upsertBar, sma, missingSessions, withWhitespace, sessionState, freshness, sanitizePrefs, readPrefs, savePrefs, STORE_KEY, isSession, chartRange } from '../public/iex-core.mjs';
const bar=(time,close=10,volume=100)=>({time,open:close,high:close+1,low:close-1,close,volume});

test('New York session dates remain correct through DST and UTC midnight',()=>{
  assert.equal(sessionDate('2026-03-06T05:00:00Z'),'2026-03-06');
  assert.equal(sessionDate('2026-03-09T04:00:00Z'),'2026-03-09');
  assert.equal(sessionDate('2026-11-02T05:00:00Z'),'2026-11-02');
  assert.equal(sessionDate('2026-10-23T00:30:00Z'),'2026-10-22');
  assert.equal(sessionDate('2026-10-22'),'2026-10-22');
  assert.throws(()=>sessionDate('2026-02-30'));
});
test('OHLCV rejects invalid numbers and bounds; sorts and replaces duplicate sessions',()=>{
  const result=normalizeBars([bar('2026-10-22',12),bar('2026-10-21'),bar('2026-10-22',13,0)]);
  assert.deepEqual(result.map(b=>b.time),['2026-10-21','2026-10-22']);assert.equal(result[1].volume,0);assert.equal(result[1].close,13);
  for(const invalid of [{close:NaN},{volume:-1},{volume:1.5},{high:2},{low:20},{open:'10'},{low:0}])assert.throws(()=>normalizeBars([{...bar('2026-10-22'),...invalid}]));
});
test('SMA is the mean of 20 available closes with 19-bar warmup',()=>{
  const bars=Array.from({length:25},(_,i)=>bar(`2026-10-${String(i+1).padStart(2,'0')}`,i+1));
  const result=sma(bars);assert.equal(result.length,6);assert.equal(result[0].value,10.5);assert.equal(result[5].value,15.5);assert.equal(sma(bars.slice(0,19)).length,0);
  bars[24].close=45;assert.equal(sma(bars).at(-1).value,16.5);
});
test('Cumulative daily snapshots replace OHLCV; late corrections keep sort order',()=>{
  const initial=[bar('2026-10-21',10,100),bar('2026-10-22',11,200)];
  const updated=upsertBar(initial,{t:'2026-10-22T04:00:00Z',o:11,h:14,l:10,c:13,v:250});
  assert.equal(updated.length,2);assert.equal(updated[1].volume,250);assert.equal(updated[1].close,13);
  const late=upsertBar(updated,bar('2026-10-21',12,120));assert.equal(late[0].close,12);assert.equal(late[1].volume,250);
});
test('Missing sessions stay whitespace; holidays and weekends do not become bars',()=>{
  const bars=[bar('2026-07-02'),bar('2026-07-07')];assert.deepEqual(missingSessions(bars),['2026-07-06']);
  const aligned=withWhitespace(bars,['2026-07-02','2026-07-06','2026-07-07']);assert.deepEqual(aligned[1],{time:'2026-07-06'});
  assert.equal(sma(bars,2).length,1);
});
test('Session status honors weekends, holidays, early closes, DST and calendar horizon',()=>{
  assert.equal(sessionState(Date.parse('2026-10-23T14:00:00Z')).phase,'open');
  assert.equal(sessionState(Date.parse('2026-10-24T14:00:00Z')).phase,'closed');
  assert.equal(sessionState(Date.parse('2026-07-03T14:00:00Z')).phase,'closed');
  assert.equal(sessionState(Date.parse('2026-11-27T17:59:00Z')).phase,'open');
  assert.equal(sessionState(Date.parse('2026-11-27T18:00:00Z')).phase,'closed');
  assert.equal(sessionState(Date.parse('2026-11-02T14:29:00Z')).phase,'closed');
  assert.equal(sessionState(Date.parse('2026-11-02T14:34:00Z')).expectedUpdates,true);
  assert.equal(sessionState(Date.parse('2029-01-02T16:00:00Z')).phase,'unknown');
});
test('Freshness distinguishes archive, reconnect, waiting, live, stale and market closure',()=>{
  const now=Date.parse('2026-10-23T15:00:00Z'),base={mode:'live',connection:'connected',now,connectedAt:now-300000};
  assert.equal(freshness({...base,mode:'history'}),'history');
  assert.equal(freshness({...base,connection:'reconnecting'}),'reconnecting');
  assert.equal(freshness({...base,connectedAt:now-1000}),'waiting');
  assert.equal(freshness({...base,lastReceived:now-60000}),'live');
  assert.equal(freshness({...base,lastReceived:now-181000}),'stale');
  assert.equal(freshness({...base,now:Date.parse('2026-10-24T15:00:00Z')}),'session-closed');
});
test('Local preferences persist exact order, indicators and zoom; corrupted storage recovers',()=>{
  const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
  const prefs={order:[...SYMBOLS].reverse(),range:'6M',sma:false,volume:false,sync:false,ranges:{AAPL:{from:12,to:45}}};
  assert.equal(savePrefs(storage,prefs),true);assert.deepEqual(readPrefs(storage),sanitizePrefs(prefs));
  data.set(STORE_KEY,'bad JSON');assert.deepEqual(readPrefs(storage).order,SYMBOLS);
  assert.deepEqual(sanitizePrefs({order:Array(8).fill('AAPL'),ranges:{AAPL:{from:5,to:1}}}).order,SYMBOLS);
  assert.equal(savePrefs({setItem(){throw Error('quota');}},prefs),false);
});
test('Range presets and reset always produce a valid range and override saved zoom only when requested',()=>{
  const prefs=sanitizePrefs({range:'3M',ranges:{AAPL:{from:12,to:45}}});
  assert.deepEqual(chartRange(prefs,159,'AAPL'),{from:12,to:45});
  assert.deepEqual(chartRange(prefs,159,'AAPL',true),{from:95,to:162});
  assert.deepEqual(chartRange({...prefs,range:'All'},159,'BOT',true),{from:0,to:162});
  assert.deepEqual(chartRange({...prefs,range:'1M'},10,'BOT',true),{from:0,to:13});
});
