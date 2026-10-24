import {CATALOG,BY_ID,CANDIDATES} from '../public/catalog.mjs';
import {canonicalKey,descriptor,stockSymbol,STOCK_NAMES} from '../public/selection.mjs';
import {blank,verifyBinance} from './feeds.mjs';
import {verifyXyz} from './equivalents.mjs';

const PROVIDERS=new Set(['all','iex','binance','xyz','reference','gate']);
export class PickerError extends Error {constructor(message,status=400){super(message);this.status=status;}}
export class InstrumentPicker {
  constructor(hub){this.hub=hub;this.pending=new Map();this.metadata=new Map();this.cooldowns=new Map();}
  async meta(route){
    const hub=this.hub,key=route==='binance'?'binanceMeta':'xyzMeta';
    if(hub.blockedRoutes.has(route))throw new PickerError('Provider access is unavailable. No alternate endpoint was tried.',403);
    if(hub[key]&&hub.now()-hub[key].at<3600000)return hub[key].value;
    if((this.cooldowns.get(route)??0)>hub.now())throw new PickerError('Provider is cooling down. Try again later.',429);
    if(!this.metadata.has(route))this.metadata.set(route,(async()=>{
      try{
        const value=route==='binance'?await hub.json('https://fapi.binance.com/fapi/v1/exchangeInfo'):await hub.json('https://api.hyperliquid.xyz/info',{type:'meta',dex:'xyz'});
        if(route==='binance'?!Array.isArray(value?.symbols):!Array.isArray(value?.universe))throw Error('Invalid metadata');
        hub[key]={at:hub.now(),value};return value;
      }catch(error){
        if([401,403,451].includes(error.status)){hub.blockedRoutes.add(route);hub.fail(hub.instruments(route),error);}
        this.cooldowns.set(route,hub.now()+60000);throw new PickerError('Could not verify this provider’s instrument list. Existing charts are unchanged.',error.status===429?429:503);
      }finally{this.metadata.delete(route);}
    })());
    return this.metadata.get(route);
  }
  entry(item){
    const d=this.hub.snapshot().symbols[item.id],loaded=Boolean(d?.bars?.length),ok=loaded&&d.connection==='connected'&&!['stale','awaiting-candle','calendar-unknown'].includes(d.status);
    const needsSubscription=item.route==='iex'&&this.hub.dynamicIex&&!this.hub.iexPublished?.has(item.pair??item.id);
    return {...item,availability:needsSubscription?'check':ok?'ready':loaded?'cached':item.route==='iex'&&!this.hub.dynamicIex?'restart':'check',status:d?.status??null};
  }
  async search(query='',provider='all'){
    if(typeof query!=='string'||query.length>48||!PROVIDERS.has(provider))throw new PickerError('Invalid search');
    const q=query.trim().toUpperCase(),items=new Map([...this.hub.instruments().filter(i=>!i.candidate||this.hub.gateCandidates),...(this.hub.gateCandidates?CANDIDATES:[])].map(i=>[i.id,i])),notes=[];
    if(q.length>=2)for(const route of ['binance','xyz'])if(provider==='all'||provider===route){
      try{const meta=await this.meta(route);
        const keys=route==='binance'?meta.symbols.filter(m=>m.status==='TRADING'&&m.contractType==='PERPETUAL'&&m.quoteAsset==='USDT'&&m.symbol===m.baseAsset+'USDT').map(m=>'BN:'+m.symbol):meta.universe.filter(m=>!m.isDelisted).map(m=>'XYZ:'+m.name);
        for(const key of keys){const id=canonicalKey(key),item=descriptor(id);if(item)items.set(id,item);}
      }catch(error){notes.push((route==='xyz'?'trade[XYZ]':'Binance')+': '+error.message);}
    }
    if(provider==='all'||provider==='iex'){
      for(const [symbol,name]of Object.entries(STOCK_NAMES))if(q&&(symbol.includes(q)||name.toUpperCase().includes(q))){const id=canonicalKey('IEX:'+symbol);items.set(id,descriptor(id));}
      const raw=q.replace(/^IEX:/,'');if(q&&stockSymbol(raw)){const id=canonicalKey('IEX:'+raw);items.set(id,descriptor(id));}
    }
    const filtered=[...items.values()].filter(i=>(provider==='all'||(provider==='reference'?i.kind==='reference':provider==='gate'?i.candidate:i.route===provider))&&(!q||[i.symbol,i.id,i.name,i.pair,i.venue,i.aliases].filter(Boolean).join(' ').toUpperCase().includes(q)));
    filtered.sort((a,b)=>(a.symbol===q?-1:b.symbol===q?1:0)||Number(!this.hub.symbols[a.id]?.bars?.length)-Number(!this.hub.symbols[b.id]?.bars?.length)||a.symbol.localeCompare(b.symbol));
    return {items:filtered.slice(0,60).map(i=>this.entry(i)),more:filtered.length>60,notes,coverage:'Current charts; active Binance USDT perpetuals; trade[XYZ] perpetuals. '+(this.hub.gateCandidates?'Two optional Gate candidates with unknown underlying delay. ':'')+(this.hub.dynamicIex?'New US stocks are checked through the connected local IEX adapter.':'US stocks require the optional private IEX launcher.')+' DRV is the supported Hyperliquid spot market. No automatic venue substitution.'};
  }
  async prepare(key){
    const id=canonicalKey(key),item=descriptor(id);if(!item)throw new PickerError('Unsupported symbol or provider');
    if(this.pending.has(id))return this.pending.get(id);
    const promise=this.prepareOne(item);this.pending.set(id,promise);try{return await promise;}finally{this.pending.delete(id);}
  }
  async prepareOne(item){
    const hub=this.hub,id=item.id;hub.leases.set(id,hub.now());
    if(item.candidate){
      if(!hub.gateCandidates)throw new PickerError('Optional candidates are still in isolated validation. Existing reference charts are unchanged.',409);
      if(hub.blockedRoutes.has('gate')||hub.blockedRoutes.has(item.route)||hub.blocked.has(id))throw new PickerError('Gate access is unavailable. Existing reference charts are unchanged.',403);
      if(hub.symbols[id]?.bars.length)return {item:this.entry(item),data:hub.snapshot().symbols[id],pending:false};
      hub.items.set(id,item);hub.symbols[id]=blank(item);
      const ok=await hub.refreshGate([item]);
      if(!ok||!hub.symbols[id]?.bars.length){
        // Retain denial state through a RAM-preserving restart, including when
        // the first request had no history. A blank failed entry is not selected.
        const denied=hub.blockedRoutes.has('gate');if(!denied){hub.items.delete(id);delete hub.symbols[id];}
        hub.publish();throw new PickerError('Candidate data could not be validated. Your chart and original daily reference are unchanged.',denied?403:503);
      }
      hub.ensureGateLoop();return {item:this.entry(item),data:hub.snapshot().symbols[id],pending:false};
    }
    if(item.route==='iex'){
      let entry=this.entry(item);
      if(hub.dynamicIex&&!['ready','cached'].includes(entry.availability)){
        try{await hub.subscribeIex(item);}catch(error){throw new PickerError(error.status===404?'No IEX daily history returned for this exact symbol. Your chart is unchanged.':error.status===409?'The free IEX stream is full. Unused added stocks are released after 10 minutes; keep currently selected stocks within 30.':error.status===403?'The IEX publisher could not authorize this data request. Existing charts are unchanged.':'IEX could not validate and subscribe to this symbol. Your current chart is unchanged. Try again when connected.',error.status??503);}
        entry=this.entry(item);
      }
      return {item:entry,pending:!['ready','cached'].includes(entry.availability),data:hub.symbols[id]??null};
    }
    if(Object.hasOwn(BY_ID,id)){
      if(!hub.symbols[id]?.bars.length)throw new PickerError('No data is available for this instrument. Your current chart is unchanged.',503);
      return {item:this.entry(item),data:hub.symbols[id],pending:false};
    }
    if(!['binance','xyz'].includes(item.route))throw new PickerError('This provider is not supported by the picker');
    if(hub.blockedRoutes.has(item.route)||hub.blocked.has(id))throw new PickerError('Provider access is unavailable. Your current chart is unchanged.',403);
    if(hub.symbols[id]?.bars.length)return {item:this.entry(item),data:hub.symbols[id],pending:false};
    const meta=await this.meta(item.route);
    if(!(item.route==='binance'?verifyBinance(meta,item):verifyXyz(meta,item.pair)))throw new PickerError('This exact market is absent or inactive in provider metadata. Your current chart is unchanged.',404);
    if(hub.instruments().filter(i=>!Object.hasOwn(BY_ID,i.id)&&i.route!=='iex').length>=32)throw new PickerError('32 additional public markets are already loaded. Unused markets are released after 10 minutes.',429);
    hub.items.set(id,item);hub.symbols[id]=blank(item);
    await (item.route==='binance'?hub.refreshBinance([item]):hub.refreshXyz([item]));
    if(!hub.symbols[id]?.bars.length){hub.items.delete(id);delete hub.symbols[id];hub.publish();throw new PickerError('No valid daily candles returned. Your current chart is unchanged.',503);}
    return {item:this.entry(item),data:hub.symbols[id],pending:false};
  }
  prune(){
    const hub=this.hub;for(const item of hub.instruments())if(!Object.hasOwn(BY_ID,item.id)&&item.route!=='iex'&&hub.now()-(hub.leases.get(item.id)??0)>600000){hub.items.delete(item.id);delete hub.symbols[item.id];hub.leases.delete(item.id);}
  }
}
