import { EventEmitter } from 'node:events';
import { SYMBOLS, normalizeBars, upsertBar, missingSessions, freshness, sessionDate } from '../public/iex-core.mjs';
import { checkedSymbols,MAX_IEX_SYMBOLS,OVERVIEW_IEX_SYMBOLS } from './iex-symbols.mjs';

export const DATA_URL = 'https://data.alpaca.markets/v2/stocks/bars';
export const STREAM_URL = 'wss://stream.data.alpaca.markets/v2/iex';
export const retryDelay = attempt => Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
export class FeedError extends Error { constructor(code, message) { super(message); this.code = code; } }

export async function fetchHistory({ key, secret, symbols = SYMBOLS, fetchImpl = fetch, now = Date.now() }) {
  symbols=checkedSymbols(symbols);
  if (!key || !secret) throw new FeedError('credentials', 'Alpaca credentials are required.');
  const collected = Object.fromEntries(symbols.map(s => [s, []]));
  const seen = new Set();
  let token;
  for (let page = 0; page < 50; page++) {
    const url = new URL(DATA_URL);
    const start = new Date(now - 400 * 86400000).toISOString();
    url.search = new URLSearchParams({ symbols:symbols.join(','), timeframe:'1Day', feed:'iex', adjustment:'raw', start, end:new Date(now).toISOString(), limit:'10000', sort:'asc', ...(token ? { page_token:token } : {}) });
    let response;
    try { response = await fetchImpl(url, { headers:{ 'APCA-API-KEY-ID':key, 'APCA-API-SECRET-KEY':secret }, signal:AbortSignal.timeout(15000) }); }
    catch { throw new FeedError('network', 'IEX history request failed. Retrying the connection.'); }
    // Never pass provider bodies, headers, credentials, or exception text to the browser/log.
    if (response.status === 401 || response.status === 403) throw new FeedError('auth', 'IEX access was not authorized. Check the approved Alpaca credentials and Basic data access.');
    if (response.status === 429) throw new FeedError('rate-limit', 'IEX rate limit reached. Reconnecting in 30 seconds.');
    if (!response.ok) throw new FeedError('network', 'IEX history is temporarily unavailable.');
    let payload;
    try { payload = await response.json(); } catch { throw new FeedError('data', 'IEX history returned unreadable data.'); }
    if (!payload || !payload.bars || typeof payload.bars !== 'object' || Array.isArray(payload.bars)) throw new FeedError('data', 'IEX history returned an unexpected format.');
    for (const symbol of symbols) {
      if (payload.bars[symbol] !== undefined && !Array.isArray(payload.bars[symbol])) throw new FeedError('data', 'IEX history returned an unexpected format.');
      collected[symbol].push(...(payload.bars[symbol] ?? []));
    }
    token = payload.next_page_token;
    if (!token) {
      try { return Object.fromEntries(symbols.map(s => [s, normalizeBars(collected[s])])); }
      catch { throw new FeedError('data', 'Invalid OHLCV received. Last good data retained.'); }
    }
    if (typeof token !== 'string' || seen.has(token)) throw new FeedError('data', 'IEX history pagination did not complete.');
    seen.add(token);
  }
  throw new FeedError('data', 'IEX history exceeded the pagination limit.');
}

export class AlpacaIexFeed extends EventEmitter {
  constructor({ key, secret, symbols = SYMBOLS, fetchImpl = fetch, WebSocketImpl = WebSocket, now = Date.now, timers = globalThis } = {}) {
    super();
    this.key=key; this.secret=secret; this.symbols=checkedSymbols(symbols); this.fetchImpl=fetchImpl; this.WebSocketImpl=WebSocketImpl; this.now=now; this.timers=timers;
    this.connection='idle'; this.message=''; this.bars=Object.fromEntries(this.symbols.map(s=>[s,[]])); this.received={};
    this.connectedAt=0; this.lastReceived=0; this.attempt=0; this.generation=0; this.stopped=true; this.pending=[];
    this.additions=new Map();this.joinedAt={};this.addition=null;
  }
  state() {
    const now=this.now();
    const symbols=Object.fromEntries(this.symbols.map(symbol=>[symbol,{ bars:this.bars[symbol], missing:missingSessions(this.bars[symbol]), lastReceived:this.received[symbol]??null, status:this.connection==='connected'&&!this.bars[symbol].length?'no-data':freshness({mode:'live',connection:this.connection,lastReceived:this.received[symbol],connectedAt:this.joinedAt[symbol]??this.connectedAt,now}), message:this.connection==='connected'&&!this.bars[symbol].length?'No IEX daily bars returned for this symbol.':'' }]));
    return { mode:'live', feed:'IEX', connection:this.connection, status:freshness({mode:'live',connection:this.connection,lastReceived:this.lastReceived,connectedAt:this.connectedAt,now}), message:this.message, lastReceived:this.lastReceived||null, serverTime:now, session:'Alpaca daily bars · America/New_York · raw', symbols };
  }
  publish() { this.emit('state',this.state()); }
  async addSymbol(symbol,retain=[]){
    try{checkedSymbols([symbol]);if(retain.length)checkedSymbols(retain);}catch{throw new FeedError('input','Invalid IEX symbol.');}
    if(this.additions.has(symbol))return this.additions.get(symbol);
    if(this.connection!=='connected'||!this.hydrated||this.stopped)throw new FeedError('unavailable','The IEX publisher must be connected before adding a stock.');
    if(this.symbols.includes(symbol)){
      if(!this.bars[symbol]?.length)throw new FeedError('no-data','No IEX daily history is available for this symbol.');
      return this.state();
    }
    if(this.additions.size)throw new FeedError('busy','Another IEX symbol is being checked. Try again shortly.');
    const promise=this.addValidatedSymbol(symbol,retain);this.additions.set(symbol,promise);
    try{return await promise;}finally{this.additions.delete(symbol);}
  }
  async addValidatedSymbol(symbol,retain){
    const generation=this.generation;
    const result=await fetchHistory({key:this.key,secret:this.secret,symbols:[symbol],fetchImpl:this.fetchImpl,now:this.now()});
    if(generation!==this.generation||this.stopped||this.connection!=='connected')throw new FeedError('unavailable','IEX disconnected during validation. Your current chart is unchanged.');
    if(!result[symbol].length)throw new FeedError('no-data','No IEX daily history returned for this exact symbol. Your current chart is unchanged.');
    if(this.symbols.length>=MAX_IEX_SYMBOLS){
      const unused=this.symbols.find(s=>!OVERVIEW_IEX_SYMBOLS.includes(s)&&!retain.includes(s));
      if(!unused)throw new FeedError('capacity','The free IEX stream allows 30 symbols. Unused added stocks can be released after 10 minutes.');
      // Only the dashboard's expired leases are eligible; originals are permanent.
      this.socket.send(JSON.stringify({action:'unsubscribe',dailyBars:[unused]}));
      this.symbols=checkedSymbols(this.symbols.filter(s=>s!==unused));delete this.bars[unused];delete this.received[unused];delete this.joinedAt[unused];
    }
    return new Promise((resolve,reject)=>{
      this.addition={symbol,bars:result[symbol],pending:[],resolve,reject};
      this.addition.timer=this.timers.setTimeout(()=>this.rejectAddition(new FeedError('unavailable','IEX did not acknowledge the new subscription. Your current chart is unchanged.')),10000);
      try{this.socket.send(JSON.stringify({action:'subscribe',dailyBars:[symbol]}));}
      catch{this.rejectAddition(new FeedError('unavailable','IEX disconnected before subscribing. Your current chart is unchanged.'));}
    });
  }
  rejectAddition(error){
    const add=this.addition;if(!add)return;this.addition=null;this.timers.clearTimeout(add.timer);
    try{this.socket?.send(JSON.stringify({action:'unsubscribe',dailyBars:[add.symbol]}));}catch{}
    add.reject(error);
  }
  acceptAddition(){
    const add=this.addition;if(!add)return;
    let bars=add.bars,receivedAt=null;
    try{for(const update of add.pending){bars=upsertBar(bars,update.message);if(sessionDate(update.message.t)===sessionDate(update.receivedAt))receivedAt=update.receivedAt;}}
    catch{this.rejectAddition(new FeedError('data','Invalid IEX daily update. Your current chart is unchanged.'));return;}
    this.addition=null;this.timers.clearTimeout(add.timer);
    this.symbols=checkedSymbols([...this.symbols,add.symbol]);this.bars[add.symbol]=bars;this.joinedAt[add.symbol]=this.now();
    if(receivedAt){this.received[add.symbol]=receivedAt;this.lastReceived=Math.max(this.lastReceived,receivedAt);}
    this.publish();add.resolve(this.state());
  }
  start() {
    if (!this.stopped) return;
    this.stopped=false;
    if (!this.key||!this.secret) { this.connection='setup-required'; this.message='Live IEX requires approved Alpaca credentials. History mode is available without setup.'; this.publish(); return; }
    this.watchdog=this.timers.setInterval(()=>{
      if (this.stopped) return;
      const state=this.state();
      if (state.status==='stale') this.fail(new FeedError('stale','No daily bar updates for over 3 minutes during the regular session. Reconnecting.'));
      else this.publish();
    },15000);
    this.open();
  }
  open() {
    if (this.stopped) return;
    const generation=++this.generation;
    this.pending=[]; this.hydrated=false;
    this.connection=this.attempt?'reconnecting':'connecting'; this.message='Connecting to IEX.'; this.publish();
    try { this.socket=new this.WebSocketImpl(STREAM_URL); }
    catch { this.fail(new FeedError('network','IEX connection failed.')); return; }
    const socket=this.socket;
    this.timeout=this.timers.setTimeout(()=>this.fail(new FeedError('network','IEX connection timed out.')),15000);
    socket.addEventListener('open',()=>{
      if(generation!==this.generation)return;
      socket.send(JSON.stringify({action:'auth',key:this.key,secret:this.secret}));
    });
    socket.addEventListener('message',event=>{
      if(generation!==this.generation)return;
      let messages;
      try { messages=JSON.parse(event.data); if(!Array.isArray(messages))throw Error(); }
      catch { this.fail(new FeedError('data','IEX stream returned unreadable data.')); return; }
      for(const message of messages){
        if(generation!==this.generation)return;
        if(message.T==='error'){
          if(this.addition&&[400,405,409].includes(message.code)){this.rejectAddition(new FeedError('subscription','IEX rejected the requested symbol or stream limit. Existing subscriptions are retained.'));continue;}
          const auth=[401,402,403,405,409].includes(message.code);
          this.fail(new FeedError(auth?'auth':'network',auth?'IEX authentication or entitlement failed. Check approved access.':'IEX stream rejected the connection. Retrying.'));
          return;
        }
        if(message.T==='success'&&message.msg==='authenticated') socket.send(JSON.stringify({action:'subscribe',dailyBars:this.symbols}));
        if(message.T==='subscription'&&this.addition&&message.dailyBars?.includes(this.addition.symbol)&&this.symbols.every(s=>message.dailyBars.includes(s)))this.acceptAddition();
        if(message.T==='subscription'&&!this.hydrated&&!this.loading&&this.symbols.every(s=>message.dailyBars?.includes(s))){
          this.loading=true; this.connection='loading'; this.message='Loading daily history.'; this.publish();
          this.timers.clearTimeout(this.timeout);
          this.hydrate(generation);
        }
        if(message.T==='d'&&message.S===this.addition?.symbol){if(this.addition.pending.length<1000)this.addition.pending.push({message,receivedAt:this.now()});}
        else if(message.T==='d'&&this.symbols.includes(message.S)) {
          if(!this.hydrated){ if(this.pending.length<10000)this.pending.push({message,receivedAt:this.now()}); }
          else this.applyDaily(message,this.now());
        }
      }
    });
    socket.addEventListener('error',()=>{if(generation===this.generation)this.fail(new FeedError('network','IEX connection interrupted.'));});
    socket.addEventListener('close',()=>{if(generation===this.generation)this.fail(new FeedError('network','IEX disconnected. Retrying automatically.'));});
  }
  async hydrate(generation) {
    try {
      const result=await fetchHistory({key:this.key,secret:this.secret,symbols:this.symbols,fetchImpl:this.fetchImpl,now:this.now()});
      if(generation!==this.generation||this.stopped)return;
      this.bars=result; this.received={}; this.joinedAt={}; this.lastReceived=0; this.connectedAt=this.now();
      for(const {message,receivedAt} of this.pending) this.applyDaily(message,receivedAt,false);
      if(generation!==this.generation)return;
      this.pending=[]; this.hydrated=true; this.loading=false; this.connection='connected'; this.message=''; this.attempt=0; this.publish();
    }catch(error){if(generation===this.generation)this.fail(error instanceof FeedError?error:new FeedError('data','Unable to validate IEX history.'));}
  }
  applyDaily(message, receivedAt, publish=true) {
    try {
      this.bars[message.S]=upsertBar(this.bars[message.S],message);
      // A correction to an old session must not make today's symbol look live.
      if(sessionDate(message.t)===sessionDate(receivedAt)) {
        this.received[message.S]=receivedAt; this.lastReceived=receivedAt;
      }
      if(publish)this.publish();
    }catch{this.fail(new FeedError('data','Invalid daily OHLCV received. Last good data retained.'));}
  }
  fail(error) {
    if(this.stopped)return;
    this.rejectAddition(new FeedError('unavailable','IEX disconnected during the symbol change. Your current chart is unchanged.'));
    ++this.generation; this.loading=false;
    this.timers.clearTimeout(this.timeout); this.timers.clearTimeout(this.retry);
    try{this.socket?.close();}catch{}
    const terminal=error.code==='auth'||error.code==='credentials';
    this.connection=terminal?'access-required':'reconnecting'; this.message=error.message; this.publish();
    if(!terminal){const delay=error.code==='rate-limit'?30000:retryDelay(this.attempt++);this.retry=this.timers.setTimeout(()=>this.open(),delay);}
  }
  stop() {
    this.rejectAddition(new FeedError('unavailable','The IEX publisher stopped.'));
    this.stopped=true; ++this.generation;
    this.timers.clearTimeout(this.timeout); this.timers.clearTimeout(this.retry); this.timers.clearInterval(this.watchdog);
    try{this.socket?.close();}catch{}
  }
}
