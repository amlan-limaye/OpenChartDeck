// Example layout: stable slot IDs retain explicit provider/equivalent descriptions.
const instrument = (id, tab, symbol, name, venue, kind, route, extra={}) => ({id,tab,symbol,name,venue,kind,route,timeframe:'1D',...extra});
const us = (symbol,tab,name) => instrument(symbol,tab,symbol,name,'IEX','equity','iex',{feed:'IEX',currency:'USD',session:'America/New_York',volumeUnit:'shares'});
const reference = (id,tab,symbol,name,route,extra) => instrument(id,tab,symbol,name,extra.venue,'reference',route,{volumeUnit:null,chartType:'line',...extra});
const xyz = (id,tab,symbol,name,pair,original,quoteUnit,difference) => instrument(id,tab,symbol,name,'Hyperliquid · trade[XYZ]','perpetual','xyz',{pair,original,quoteUnit,difference,feed:'trade[XYZ]',currency:'USDC settled',volumeUnit:`${pair} contract units`,session:'UTC daily perpetual trades',equivalent:true});
const crypto = (base,tab) => instrument(base,tab,base==='BTC'?'BTCUSDT.P':base,`${base} / USDT perpetual`,'BINANCE','perpetual','binance',{pair:base+'USDT',feed:'Binance',currency:'USDT',session:'UTC · 24/7',volumeUnit:base});
export const TABS = ['Gold','AI','Crypto','Indices'];
export const CATALOG = [
  reference('DXY','Indices','USD BASKET','DXY basket · daily reference','ecb',{venue:'ECB',feed:'ECB reference',original:'TVC:DXY',equivalent:true,calendar:'target',quoteUnit:'Index points',difference:'Derived from ECB daily reference FX with the six DXY currencies, published weights and scaling constant. Different fixing time and quote source from the official ICE index; not a live DXY quote.'}),
  xyz('USDJPY','Indices','USDJPY PERP','Yen per US dollar','xyz:JPY','OANDA:USDJPY','JPY per USD','Spot FX-linked perpetual, quoted in yen per US dollar. Actual trade prices can differ from OANDA spot quotes; USDC settled.'),
  reference('US10Y','Indices','US10Y YIELD','Treasury par yield · %','treasury',{venue:'US Treasury',feed:'US Treasury',original:'TVC:US10Y',equivalent:true,calendar:'treasury',quoteUnit:'Percent per year',difference:'Official daily 10-year constant-maturity par yield, interpolated from the Treasury curve. A yield, not a bond price; differs from an intraday on-the-run Treasury quote.'}),
  crypto('BTC','Indices'),
  reference('VIX','Indices','VIX','Cboe spot index · daily OHLC','cboe',{venue:'Cboe',feed:'Cboe VIX',chartType:'candles',original:'TVC:VIX',calendar:'cboe',quoteUnit:'Index points',difference:'Official Cboe VIX spot-index daily history, updated daily rather than intraday. No index trading volume. © Cboe Exchange, Inc. All rights reserved. Permission required; see provider-use documentation.'}),
  xyz('NAS100USD','Indices','XYZ100 PERP','US Tech 100 · NAS100 alternative','xyz:XYZ100','OANDA:NAS100USD','Index points','trade[XYZ] US large-cap technology/growth 100-stock benchmark perpetual. A Nasdaq-100-style alternative; not labelled as the official Nasdaq-100 or the OANDA CFD. Composition, funding and out-of-hours prices can differ.'),
  xyz('KOSPI','Indices','KOREA 200','KR200 perp · KOSPI alternative','xyz:KR200','KRX:KOSPI','Korean index points','Perpetual referencing a 200-stock Korean benchmark in local index points, with USDC quanto settlement. Narrower coverage than the KOSPI Composite; no KRW/USD conversion is applied to the displayed index level.'),
  us('PLTR','Indices','Palantir'),
  xyz('GC1!','Gold','GOLD PERP','Spot-linked gold · GC1! alternative','xyz:GOLD','COMEX_DL:GC1!','USD per troy ounce','Spot XAU/USD-linked perpetual. Replaces the continuous COMEX future: no GC contract roll, futures basis, settlement-close selection or back adjustment. Actual perpetual trade candles.'),
  us('GDX','Gold','Gold Miners ETF'), us('HOOD','Gold','Robinhood'), us('IGV','Gold','Software ETF'),
  xyz('OILUSD','Gold','WTI PERP','WTI crude · OILUSD alternative','xyz:CL','EASYMARKETS:OILUSD','USD per barrel','WTI light sweet crude, matching the original oil benchmark. Futures-linked perpetual, not the easyMarkets CFD; reference contracts roll progressively from the fifth to tenth business day of each month. Funding and roll basis affect prices.'),
  xyz('XAGUSD','Gold','SILVER PERP','Spot-linked silver · XAGUSD','xyz:SILVER','OANDA:XAGUSD','USD per troy ounce','Spot XAG/USD-linked perpetual, quoted in USD per troy ounce. Actual trade candles can differ from OANDA spot quotes; USDC settled.'),
  us('SPCX','Gold','SPCX'), us('ARKG','Gold','ARK Genomic Revolution ETF'),
  us('DRAM','AI','Roundhill Memory ETF'), us('CRWV','AI','CoreWeave'), us('MAGS','AI','Magnificent Seven ETF'), us('AAPL','AI','Apple'),
  us('ORCL','AI','Oracle'), us('SOXX','AI','Semiconductor ETF'), us('META','AI','Meta Platforms'), us('BOT','AI','RoboStrategy'),
  crypto('ETH','Crypto'), crypto('LIT','Crypto'), crypto('HYPE','Crypto'),
  instrument('DRV','Crypto','DRV','DRV / USDC spot','HYPERLIQUID','spot','hyperliquid',{feed:'Hyperliquid',currency:'USDC',session:'UTC · 24/7',volumeUnit:'DRV'}),
  crypto('WLD','Crypto'), crypto('ZEC','Crypto'), crypto('VVV','Crypto'), crypto('AAVE','Crypto'),
];
export const BY_ID = Object.fromEntries(CATALOG.map(i=>[i.id,i]));
// Optional candidates never replace a saved slot or merge with reference history.
export const CANDIDATES=[
  instrument('GATE:CFD:USIDX',null,'USIDX CFD','Dollar index CFD · DXY candidate','Gate CFD','cfd','gate-cfd',{pair:'USIDX',feed:'Gate CFD',currency:'Index points',quoteUnit:'Index points',volumeUnit:null,chartType:'candles',candidate:true,fallbackId:'DXY',aliases:'DXY dollar basket',notice:'CFD candidate · delay unknown',difference:'Gate dollar-index CFD, not official ICE DXY. Exact upstream construction and delay are unverified. Broker-day candles use the following session date for 21:00/22:00 UTC starts. No trading volume is provided. The ECB daily basket remains available as a separate reference.'}),
  instrument('GATE:PERP:VOLX_USDT',null,'VOLX PERP','Volatility perpetual proxy · optional','Gate perpetual','perpetual','gate-perp',{pair:'VOLX_USDT',feed:'Gate perp',currency:'USDT',quoteUnit:'Volatility proxy points',volumeUnit:'contracts · 0.1 multiplier',candidate:true,fallbackId:'VIX',aliases:'VIX volatility',notice:'Perpetual proxy · not spot VIX',difference:'Gate VOLX_USDT perpetual trades, not official spot VIX. Its composite reference can include its own perpetual; funding, thin liquidity and closed underlying markets can cause material basis. Provider delay is unknown. Official Cboe daily VIX remains a separate reference.'}),
];
export const layouts = Object.fromEntries(TABS.map(tab=>[tab,CATALOG.filter(i=>i.tab===tab).map(i=>i.id)]));
export const sourceId = item => item.candidate?item.id:item.route==='iex'?`IEX:${item.pair??item.id}`:item.route==='xyz'?`HYPERLIQUID:${item.pair}`:item.route==='binance'?`BINANCE:${item.pair}.P`:item.id==='DRV'?'HYPERLIQUID:DRVUSDC':`${item.venue}:${item.symbol}`;

// Locally saved slot selection model. Keys identify an exact provider and instrument.

export const STOCK_NAMES={TSLA:'Tesla',MSFT:'Microsoft',NVDA:'NVIDIA',AMZN:'Amazon',GOOGL:'Alphabet',SPY:'SPDR S&P 500 ETF',QQQ:'Invesco QQQ ETF'};
export const stockSymbol = value => typeof value==='string'&&/^[A-Z][A-Z0-9]{0,9}(?:\.[A-Z])?$/.test(value);
export function descriptor(key){
  if(typeof key!=='string')return null;
  if(Object.hasOwn(BY_ID,key))return BY_ID[key];
  const candidate=CANDIDATES.find(i=>i.id===key);if(candidate)return candidate;
  if(key.startsWith('IEX:')&&stockSymbol(key.slice(4))){
    const symbol=key.slice(4);
    return {id:key,symbol,name:STOCK_NAMES[symbol]??`${symbol} · US stock / ETF request`,venue:'IEX',kind:'equity',route:'iex',pair:symbol,feed:'IEX',currency:'USD',volumeUnit:'shares',session:'America/New_York',timeframe:'1D'};
  }
  if(/^BN:[A-Z0-9]{1,24}USDT$/.test(key)){
    const pair=key.slice(3),base=pair.slice(0,-4);
    return {id:key,symbol:pair+'.P',name:`${base} / USDT perpetual`,venue:'BINANCE',kind:'perpetual',route:'binance',pair,base,feed:'Binance',currency:'USDT',volumeUnit:base,session:'UTC · 24/7',timeframe:'1D'};
  }
  if(/^XYZ:xyz:[A-Z0-9][A-Z0-9._-]{0,23}$/.test(key)){
    const pair=key.slice(4),base=pair.slice(4);
    return {id:key,symbol:base+' PERP',name:`${base} · trade[XYZ] perpetual`,venue:'Hyperliquid · trade[XYZ]',kind:'perpetual',route:'xyz',pair,feed:'trade[XYZ]',currency:'USDC settled',volumeUnit:pair+' contract units',session:'UTC daily perpetual trades',timeframe:'1D',difference:'Actual trade[XYZ] perpetual trades, not ownership of an underlying stock or the official underlying index. Funding, basis and out-of-hours prices may differ. Reference identity and quote units are not independently mapped for this added market.'};
  }
  return null;
}
export function canonicalKey(key){
  const item=descriptor(key);if(!item)return null;
  return CATALOG.find(i=>i.route===item.route&&(i.pair??i.id)===(item.pair??item.id))?.id??item.id;
}
export const selectedKey=(prefs,slot)=>canonicalKey(prefs.selections?.[slot])??slot;
export const selectedInfo=(prefs,slot)=>descriptor(selectedKey(prefs,slot));
export function sanitizeSelections(raw={}){
  const selections={},pending={},undo={};
  for(const slot of Object.keys(BY_ID)){
    const key=canonicalKey(raw.selections?.[slot]);if(key&&key!==slot)selections[slot]=key;
    const request=canonicalKey(raw.pending?.[slot]);if(request&&descriptor(request).route==='iex'&&request!==(key??slot))pending[slot]=request;
    const previous=raw.undo?.[slot],previousKey=canonicalKey(previous?.selection);
    if(previousKey){const p=canonicalKey(previous.pending);undo[slot]={selection:previousKey,pending:p&&descriptor(p).route==='iex'?p:null};}
  }
  return {selections,pending,undo};
}
export function changeSlot(prefs,slot,key,{queue=false}={}){
  key=canonicalKey(key);if(!Object.hasOwn(BY_ID,slot)||!key)throw Error('Unsupported instrument');
  const next={...prefs,...sanitizeSelections(prefs)};
  next.undo[slot]={selection:selectedKey(prefs,slot),pending:prefs.pending?.[slot]??null};
  if(queue){if(descriptor(key).route!=='iex')throw Error('Only IEX requests can be queued');next.pending[slot]=key;}
  else{if(key===slot)delete next.selections[slot];else next.selections[slot]=key;delete next.pending[slot];}
  return next;
}
export function undoSlot(prefs,slot){
  const next={...prefs,...sanitizeSelections(prefs)},previous=next.undo[slot];if(!previous)return next;
  if(previous.selection===slot)delete next.selections[slot];else next.selections[slot]=previous.selection;
  if(previous.pending)next.pending[slot]=previous.pending;else delete next.pending[slot];delete next.undo[slot];return next;
}
export function promotePending(prefs,state){
  let next=prefs;for(const [slot,key]of Object.entries(prefs.pending??{})){
    const d=state?.symbols?.[key];
    if(d?.feed==='IEX'&&d.mode==='live'&&d.connection==='connected'&&d.bars?.length&&!['stale','no-data'].includes(d.status)){const previous=next.undo?.[slot];next=changeSlot(next,slot,key);if(previous)next.undo[slot]=previous;}
  }return next;
}
export function iexPlan(prefs){
  const symbols=new Set(CATALOG.filter(i=>i.route==='iex').map(i=>i.id));
  for(const key of [...Object.values(prefs.selections??{}),...Object.values(prefs.pending??{})]){const item=descriptor(key);if(item?.route==='iex')symbols.add(item.pair??item.id);}
  if(symbols.size>30)throw Error('The free Basic plan allows 30 streaming symbols. Remove a queued stock first.');
  return {version:1,feed:'iex',symbols:[...symbols]};
}
