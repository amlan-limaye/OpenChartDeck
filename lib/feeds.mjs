import { EventEmitter } from 'node:events';
import { CATALOG } from '../public/catalog.mjs';
import {descriptor,stockSymbol,canonicalKey} from '../public/selection.mjs';
import { DAY, utcDate, normalizeBars, gaps, pollStatus } from '../public/core.mjs';
import {referenceStatus,externalReferenceSession} from '../public/reference.mjs';
import {CBOE_URL,TREASURY_URL,ECB_URL,parseEcbDxy,parseTreasury,parseVix,verifyXyz,mergeReference} from './equivalents.mjs';
import {GATE,GATE_POLL_MS,verifyGateCfd,verifyGatePerp,parseGateCandles,cfdEvidence,perpEvidence,gateStatus} from './gate.mjs';
const BN='https://fapi.binance.com', HL='https://api.hyperliquid.xyz/info';
const EXPANSION='IEX is not configured. Start the private paper-IEX launcher to connect supported stocks.';
export const blank = item => ({bars:[],missing:[],feed:item.feed,mode:'unavailable',connection:'unavailable',status:item.route==='iex'?'setup-required':'unavailable',message:item.reason??(item.route==='iex'?EXPANSION:'Checking the exact public market…'),lastFetched:null,lastReceived:null,session:item.session??'Not connected',volumeUnit:item.volumeUnit??null});
function number(value){if(!['number','string'].includes(typeof value)||value==='')throw Error('Invalid numeric field');const n=Number(value);if(!Number.isFinite(n))throw Error('Invalid numeric field');return n;}
export function parseBinance(rows,now=Date.now()){
  if(!Array.isArray(rows))throw Error('Invalid Binance response');
  return normalizeBars(rows.map(r=>{
    if(!Array.isArray(r)||r.length<7||r[0]>now||r[6]!==r[0]+DAY-1)throw Error('Invalid Binance daily interval');
    return {time:utcDate(r[0]),open:number(r[1]),high:number(r[2]),low:number(r[3]),close:number(r[4]),volume:number(r[5])};
  }));
}
export function parseHyperliquid(rows,coin,now=Date.now()){
  if(!Array.isArray(rows))throw Error('Invalid Hyperliquid response');
  return normalizeBars(rows.map(r=>{
    if(r.s!==coin||r.i!=='1d'||r.t>now||r.T!==r.t+DAY-1)throw Error('Unexpected Hyperliquid market or interval');
    return {time:utcDate(r.t),open:number(r.o),high:number(r.h),low:number(r.l),close:number(r.c),volume:number(r.v)};
  }));
}
export function resolveDrv(meta){
  if(!Array.isArray(meta?.universe)||!Array.isArray(meta?.tokens))throw Error('Invalid spot metadata');
  const tokens=new Map(meta.tokens.map(t=>[t.index,t]));
  const matches=meta.universe.filter(p=>p.tokens?.length===2&&tokens.get(p.tokens[0])?.name==='DRV'&&tokens.get(p.tokens[1])?.name==='USDC');
  if(matches.length!==1||matches[0].name!==`@${matches[0].index}`)throw Error('DRV/USDC market is unavailable or ambiguous');
  return {coin:matches[0].name,baseIndex:matches[0].tokens[0],quoteIndex:matches[0].tokens[1]};
}
export function verifyBinance(meta,item){
  const m=meta?.symbols?.find(s=>s.symbol===item.pair);
  return Boolean(m&&m.status==='TRADING'&&m.contractType==='PERPETUAL'&&m.baseAsset===(item.base??item.id)&&m.quoteAsset==='USDT');
}
export function mergeHistory(previous,incoming){return normalizeBars([...previous,...incoming]).slice(-499);}
export function historyStart(bars,now){return Math.max(now-400*DAY,bars.length?Date.parse(bars.at(-1).time+'T00:00:00Z')-2*DAY:now-400*DAY);}
export function applyBridge(state,current,now=Date.now(),items=CATALOG.filter(i=>i.route==='iex')){
  if(!state||state.mode!=='live'||state.feed!=='IEX'||!state.symbols)throw Error('Expected the existing live IEX application');
  const result={};
  for(const item of items){
    const raw=state.symbols[item.pair??item.id];
    if(!raw){result[item.id]={...blank(item),bars:current[item.id]?.bars??[]};continue;}
    const bars=normalizeBars(raw.bars??[]);
    if(bars.some(b=>!Number.isInteger(b.volume)))throw Error('Invalid IEX share volume');
    const outdated=!Number.isFinite(state.serverTime)||now-state.serverTime>45000;
    result[item.id]={bars,missing:gaps(bars,'equity'),feed:'IEX',mode:'live',connection:state.connection,status:outdated?'stale':raw.status??state.status,message:outdated?'The source application has stopped refreshing.':raw.message||state.message||'',lastFetched:now,lastReceived:raw.lastReceived??null,session:'America/New_York · raw daily bars',volumeUnit:'shares',transport:'Local IEX adapter · events and 15s health checks'};
  }
  return result;
}
export class FeedHub extends EventEmitter {
  constructor({fetcher=fetch,now=Date.now,schedule=setTimeout,cancel=clearTimeout,seed,gateCandidates=seed?.capabilities?.gateCandidates!==0,iexState=null,iexSubscribe=null,cboeEnabled=true}={}){
    super();Object.assign(this,{fetcher,now,schedule,cancel,gateCandidates,iexState,iexSubscribe,cboeEnabled});this.items=new Map(CATALOG.map(i=>[i.id,i]));this.symbols=Object.fromEntries(CATALOG.map(i=>[i.id,blank(i)]));this.timers=new Set();this.stopped=true;this.blocked=new Set();this.blockedRoutes=new Set();this.binanceMeta=null;this.drv=null;this.leases=new Map();
    this.seeded=seed?.version===1;
    if(this.seeded)for(const [key,data]of Object.entries(seed.symbols??{})){
      const item=descriptor(key);if(!item||!Array.isArray(data.bars))continue;
      this.items.set(key,item);this.symbols[key]=structuredClone(data);
      if(data.status==='access-unavailable'){this.blocked.add(key);this.blockedRoutes.add(item.route);if(item.candidate)this.blockedRoutes.add('gate');}
      if(!CATALOG.some(i=>i.id===key))this.leases.set(key,this.now());
    }
  }
  instruments(route){return [...this.items.values()].filter(i=>!route||i.route===route);}
  snapshot(){
    const now=this.now(),symbols={};
    for(const item of this.items.values()){const data=this.symbols[item.id];symbols[item.id]={...data,...(item.route==='xyz'?(CATALOG.some(i=>i.id===item.id)?externalReferenceSession(item,now):{externalSession:'Underlying reference identity, holiday and session schedule are not independently verified; these are perpetual trade candles.'}):{}),status:item.candidate?gateStatus(data,now):data.mode==='reference'?referenceStatus(data,now):data.mode==='public'?pollStatus(data,now):data.status};}
    return {version:1,capabilities:{picker:1,ecbDirect:1,gateCandidates:this.gateCandidates?1:0},serverTime:now,symbols};
  }
  publish(){this.emit('state',this.snapshot());}
  async json(url,body){
    const response=await this.fetcher(url,{signal:AbortSignal.timeout(10000),redirect:'error',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
    if(!response.ok){const error=Error(`HTTP ${response.status}`);error.status=response.status;throw error;}
    return response.json();
  }
  async publicText(url){
    let response;try{response=await this.fetcher(url,{signal:AbortSignal.timeout(15000),redirect:'error'});}catch(cause){const error=Error('Public request failed');error.kind=['TimeoutError','AbortError'].includes(cause?.name)?'timeout':'transport';throw error;}
    if(!response.ok){const error=Error(`HTTP ${response.status}`);error.status=response.status;throw error;}
    if(Number(response.headers?.get('content-length'))>2000000)throw Error('Public response too large');
    const text=await response.text();if(text.length>2000000)throw Error('Public response too large');return text;
  }
  fail(items,error){
    const denied=[401,403,451].includes(error?.status);
    if(denied)for(const item of items)this.blockedRoutes.add(item.route);
    for(const item of items){const previous=this.symbols[item.id];this.symbols[item.id]={...previous,connection:denied?'unavailable':'disconnected',status:denied?'access-unavailable':'reconnecting',lastErrorCode:Number.isInteger(error?.status)?`http-${error.status}`:['timeout','transport'].includes(error?.kind)?error.kind:'invalid-or-unknown-response',message:denied?`Public endpoint access is unavailable (HTTP ${error.status}). No alternate endpoint was substituted.`:error?.status===429?'Provider rate limit. Retrying after a pause.':'Feed could not refresh. Last received bars are retained; reconnecting.'};if(denied)this.blocked.add(item.id);}
    this.publish();
  }
  async refreshIex(){
    let items=this.instruments('iex');
    try{if(!this.iexState)return true;const state=await this.iexState();
      this.ingestIex(state);return true;}
    catch(error){for(const item of items.filter(i=>this.symbols[i.id].bars.length)){this.symbols[item.id]={...this.symbols[item.id],connection:'disconnected',status:'reconnecting',message:'The IEX adapter is unavailable. Last received bars are retained.'};}for(const item of items.filter(i=>!this.symbols[i.id].bars.length))this.symbols[item.id]={...blank(item),connection:'disconnected',status:'reconnecting',message:'Waiting for the configured IEX adapter.'};this.publish();return false;}
  }
  ingestIex(state){
    if(state?.mode!=='live'||state.feed!=='IEX'||!state.symbols)throw Error('Expected IEX state');
    this.dynamicIex=state.capabilities?.dynamicIex===1;
    this.iexPublished=new Set(Object.keys(state.symbols));
    for(const symbol of [...this.iexPublished].slice(0,30)){if(!stockSymbol(symbol))continue;const key=canonicalKey('IEX:'+symbol),item=descriptor(key);if(!this.items.has(key)){this.items.set(key,item);this.symbols[key]=blank(item);}}
    Object.assign(this.symbols,applyBridge(state,this.symbols,this.now(),this.instruments('iex')));this.publish();
  }
  async subscribeIex(item){
    // Only validated ticker names reach the injected read-only adapter. Credentials
    // remain inside its process memory. Ten-minute leases cover tabs
    // and undo; the original fourteen are additionally protected by the publisher.
    const retain=this.instruments('iex').filter(i=>this.iexPublished?.has(i.pair??i.id)&&(CATALOG.some(c=>c.id===i.id)||this.now()-(this.leases.get(i.id)??0)<600000)).map(i=>i.pair??i.id);
    if(!this.iexSubscribe){const error=Error('IEX is not configured');error.status=409;throw error;}
    this.ingestIex(await this.iexSubscribe(item.pair??item.id,retain));
    if(!this.symbols[item.id]?.bars.length||!this.iexPublished.has(item.pair??item.id))throw Error('Missing validated IEX history');
  }
  accept(item,incoming,extra={}){
    if(!incoming.length)throw Error('No daily bars returned');
    const bars=mergeHistory(this.symbols[item.id].bars,incoming);
    this.symbols[item.id]={...this.symbols[item.id],...extra,bars,missing:gaps(bars,item.kind),feed:item.feed,mode:'public',connection:'connected',status:'polling',message:item.route==='xyz'?'Actual perpetual trade candles. Underlying cash markets may be closed while the perpetual price moves; funding, premium and internal pricing can produce differences.':'Public daily candles · refreshed every 60 seconds',lastFetched:this.now(),session:item.route==='xyz'?'UTC daily perpetual trades · external reference follows its market hours':'UTC daily candles · 24/7',volumeUnit:item.volumeUnit,transport:'Public REST · 60s refresh'};
    this.publish();
  }
  async refreshBinance(only){
    const items=(only??this.instruments('binance')).filter(i=>!this.blocked.has(i.id));if(!items.length||this.blockedRoutes.has('binance'))return true;
    try{if(!this.binanceMeta||this.now()-this.binanceMeta.at>3600000)this.binanceMeta={at:this.now(),value:await this.json(BN+'/fapi/v1/exchangeInfo')};}
    catch(error){this.fail(items,error);return false;}
    let good=true;
    // Sequential bounded requests keep the local workload and rate use small.
    for(const item of items){
      if(!verifyBinance(this.binanceMeta.value,item)){this.symbols[item.id]={...blank(item),status:'unavailable',message:'The exact requested perpetual market is not active in exchange metadata.'};this.publish();continue;}
      try{
        const now=this.now(),start=historyStart(this.symbols[item.id].bars,now),limit=Math.min(499,Math.ceil((now-start)/DAY)+2);
        const url=new URL('/fapi/v1/klines',BN);url.search=new URLSearchParams({symbol:item.pair,interval:'1d',startTime:String(Math.floor(start)),limit:String(limit)});
        this.accept(item,parseBinance(await this.json(url),now),{providerSymbol:item.pair,verifiedAt:this.binanceMeta.at});
      }catch(error){good=false;this.fail([item],error);if([403,451,429].includes(error?.status)){this.fail(items,error);break;}}
    }
    return good;
  }
  async refreshHyperliquid(){
    const item=CATALOG.find(i=>i.route==='hyperliquid');if(this.blocked.has(item.id)||this.blockedRoutes.has('hyperliquid'))return true;
    try{
      if(!this.drv||this.now()-this.drv.at>3600000)this.drv={...resolveDrv(await this.json(HL,{type:'spotMeta'})),at:this.now()};
      const now=this.now();const rows=await this.json(HL,{type:'candleSnapshot',req:{coin:this.drv.coin,interval:'1d',startTime:Math.floor(historyStart(this.symbols.DRV.bars,now)),endTime:now}});
      this.accept(item,parseHyperliquid(rows,this.drv.coin,now),{providerSymbol:this.drv.coin,marketIdentity:this.drv,verifiedAt:this.drv.at});return true;
    }catch(error){this.fail([item],error);return false;}
  }
  async refreshXyz(only){
    const items=(only??this.instruments('xyz')).filter(i=>!this.blocked.has(i.id));if(!items.length||this.blockedRoutes.has('xyz'))return true;
    try{if(!this.xyzMeta||this.now()-this.xyzMeta.at>3600000)this.xyzMeta={at:this.now(),value:await this.json(HL,{type:'meta',dex:'xyz'})};}
    catch(error){this.fail(items,error);return false;}
    let good=true;
    for(const item of items){
      if(!verifyXyz(this.xyzMeta.value,item.pair)){good=false;this.symbols[item.id]={...this.symbols[item.id],connection:'unavailable',status:'unavailable',message:'The selected perpetual is missing, ambiguous or delisted in provider metadata. No replacement is automatic.'};this.publish();continue;}
      try{const now=this.now(),rows=await this.json(HL,{type:'candleSnapshot',req:{coin:item.pair,interval:'1d',startTime:Math.floor(historyStart(this.symbols[item.id].bars,now)),endTime:now}});this.accept(item,parseHyperliquid(rows,item.pair,now),{providerSymbol:item.pair,verifiedAt:this.xyzMeta.at});}
      catch(error){good=false;this.fail([item],error);if([403,451,429].includes(error?.status)){this.fail(items,error);break;}}
    }
    return good;
  }
  async refreshReference(route){
    if(route==='cboe'&&!this.cboeEnabled){const item=this.instruments('cboe')[0];this.symbols[item.id]={...blank(item),status:'setup-required',message:'Cboe content permission is required. Enable --cboe only with appropriate rights; see docs/PROVIDER-USE.md.'};this.publish();return true;}
    const item=CATALOG.find(i=>i.route===route);if(this.blocked.has(item.id))return true;
    try{
      const now=this.now();let incoming;
      if(route==='ecb'){
        incoming=parseEcbDxy(await this.publicText(ECB_URL),now);
      }else if(route==='treasury'){
        incoming=[];const startYear=new Date(now-400*DAY).getUTCFullYear(),year=new Date(now).getUTCFullYear();
        for(let y=startYear;y<=year;y++){
          // Prior-year data is downloaded once per process, then kept only in memory.
          if(y<year&&this.treasuryYears?.has(y))continue;
          const url=new URL(TREASURY_URL);url.search=new URLSearchParams({data:'daily_treasury_yield_curve',field_tdr_date_value:String(y)});
          incoming.push(...parseTreasury(await this.publicText(url),now));
        }
      }else incoming=parseVix(await this.publicText(CBOE_URL),now);
      if(!incoming.length)throw Error('No reference observations');
      const bars=mergeReference(this.symbols[item.id].bars,incoming,item.chartType,now);
      if(!bars.length)throw Error('No recent reference observations');
      this.symbols[item.id]={...this.symbols[item.id],bars,missing:gaps(bars,'reference',item.calendar),feed:item.feed,mode:'reference',connection:'connected',status:'daily-reference',lastFetched:now,calendar:item.calendar,pollMs:3600000,session:route==='ecb'?'ECB business-day fixing · about 16:00 Frankfurt':route==='treasury'?'US business-day par yield · indicative rates around 15:30 New York':'US VIX daily index history · published after the session',volumeUnit:null,transport:'Official daily reference · checked hourly',message:item.difference,providerSymbol:route==='ecb'?'ECB six-currency DXY basket':route==='treasury'?'BC_10YEAR':'VIX',chartType:item.chartType};
      this.symbols[item.id].lastErrorCode=null;if(route==='ecb')this.symbols[item.id].sourceUrl=ECB_URL;
      if(route==='treasury')this.treasuryYears=new Set(Array.from({length:new Date(now).getUTCFullYear()-new Date(now-400*DAY).getUTCFullYear()},(_,i)=>new Date(now-400*DAY).getUTCFullYear()+i));
      this.publish();return true;
    }catch(error){this.fail([item],error);return false;}
  }
  async refreshGate(only){
    const items=(only??this.instruments().filter(i=>i.candidate)).filter(i=>!this.blocked.has(i.id)&&!this.blockedRoutes.has(i.route));
    if(!items.length||this.blockedRoutes.has('gate'))return true;
    for(const item of items){
      try{
        const cfd=item.route==='gate-cfd',now=this.now();
        this.gateMeta??=new Map();let meta=this.gateMeta.get(item.route);
        if(!meta||now-meta.at>=3600000){
          const raw=await this.json(GATE+(cfd?'/tradfi/symbols':'/futures/usdt/contracts/VOLX_USDT'));
          const details=cfd?(verifyGateCfd(raw,now),{}):verifyGatePerp(raw);
          meta={at:now,...details};this.gateMeta.set(item.route,meta);
        }
        const history=await this.json(GATE+(cfd?'/tradfi/symbols/USIDX/klines?kline_type=1d&limit=120':'/futures/usdt/candlesticks?contract=VOLX_USDT&interval=1d&limit=120'));
        const parsed=parseGateCandles(history,{cfd,now:this.now()});
        const ticker=await this.json(GATE+(cfd?'/tradfi/symbols/USIDX/tickers':'/futures/usdt/tickers?contract=VOLX_USDT'));
        const timing=await this.json(GATE+(cfd?'/tradfi/symbols/USIDX/klines?kline_type=1m&limit=3':'/futures/usdt/order_book?contract=VOLX_USDT&limit=5&with_id=true'));
        const evidence=cfd?cfdEvidence(ticker,timing,this.now()):perpEvidence(ticker,timing,this.now());
        if(evidence.sourceTime<parsed.dailySessionOpen)throw Error('Quote evidence predates displayed candle');
        const previous=this.symbols[item.id]??blank(item),bars=normalizeBars([...previous.bars,...parsed.bars],{noVolume:cfd}).slice(-499);
        if(bars.length<20)throw Error('Insufficient history for SMA20');
        this.symbols[item.id]={...previous,...evidence,bars,dailySessionOpen:parsed.dailySessionOpen,missing:gaps(bars,item.kind),feed:item.feed,mode:'candidate',connection:'connected',status:cfd?'candidate-polling':'proxy-polling',lastFetched:this.now(),lastErrorCode:null,providerSymbol:item.pair,verifiedAt:meta.at,sourceDelay:'Unknown; market-open freshness has not been established',session:cfd?'Broker D1 starts at 21:00/22:00 UTC (or 00:00 when returned); shown by session date. Holiday calendar unverified.':'UTC daily perpetual trade candles; underlying sources may hold their last close',volumeUnit:item.volumeUnit,transport:'Public REST · 60s refresh · no account or key',pollMs:GATE_POLL_MS,message:item.difference,fallbackId:item.fallbackId,...(!cfd?{fundingInterval:meta.fundingInterval,multiplier:meta.multiplier}:{})};
        this.publish();
      }catch(error){
        if([401,403,451].includes(error.status)){this.blockedRoutes.add('gate');this.fail(this.instruments().filter(i=>i.candidate),error);}
        else this.fail([item],error);
        return false;
      }
    }
    return true;
  }
  ensureGateLoop(delay=GATE_POLL_MS){
    if(this.stopped||this.gateTimer||this.blockedRoutes.has('gate')||!this.instruments().some(i=>i.candidate))return;
    const timer=this.schedule(async()=>{
      this.timers.delete(timer);this.gateTimer=null;if(this.stopped)return;
      const ok=await this.refreshGate();this.gateFailures=ok?0:(this.gateFailures??0)+1;
      this.ensureGateLoop(Math.min(300000,GATE_POLL_MS*2**Math.min(this.gateFailures,5)));
    },delay);this.gateTimer=timer;this.timers.add(timer);
  }
  start(){
    if(!this.stopped)return;this.stopped=false;
    const loop=(operation,base)=>{let failures=0;const run=async()=>{if(this.stopped)return;const ok=await operation.call(this);failures=ok?0:failures+1;if(!this.stopped){const timer=this.schedule(()=>{this.timers.delete(timer);run();},Math.min(Math.max(base*4,300000),base*2**Math.min(failures,5)));this.timers.add(timer);}};if(this.seeded&&base>=60000){const timer=this.schedule(()=>{this.timers.delete(timer);run();},base);this.timers.add(timer);}else run();};
    loop(this.refreshIex,15000);loop(this.refreshBinance,60000);loop(this.refreshHyperliquid,60000);loop(this.refreshXyz,60000);
    for(const route of ['ecb','treasury','cboe'])loop(()=>this.refreshReference(route),3600000);
    this.ensureGateLoop();
  }
  stop(){this.stopped=true;for(const timer of this.timers)this.cancel(timer);this.timers.clear();this.gateTimer=null;}
}
