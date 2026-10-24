import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {FeedHub} from './lib/feeds.mjs';
import {AlpacaIexFeed} from './lib/alpaca.mjs';
import {OVERVIEW_IEX_SYMBOLS} from './lib/iex-symbols.mjs';
import {createDemoFeed} from './lib/demo.mjs';
import {InstrumentPicker,PickerError} from './lib/picker.mjs';
const root=new URL('./',import.meta.url);
const files={
  '/':['public/index.html','text/html'], '/app.mjs':['public/app.mjs','text/javascript'],
  '/core.mjs':['public/core.mjs','text/javascript'], '/catalog.mjs':['public/catalog.mjs','text/javascript'], '/iex-core.mjs':['public/iex-core.mjs','text/javascript'],
  '/reference.mjs':['public/reference.mjs','text/javascript'],
  '/selection.mjs':['public/selection.mjs','text/javascript'],
  '/styles.css':['public/styles.css','text/css'], '/licenses':['public/licenses.html','text/html'],
  '/vendor/charts.mjs':['node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.mjs','text/javascript'],
  '/LICENSE':['licenses/lightweight-charts.txt','text/plain'], '/app-license':['LICENSE','text/plain'], '/NOTICE':['NOTICE','text/plain'],
  '/licenses/lightweight-charts':['licenses/lightweight-charts.txt','text/plain'], '/licenses/fancy-canvas':['licenses/fancy-canvas.txt','text/plain'],
};
export function createApp({feed=new FeedHub()}={}){
  const picker=new InstrumentPicker(feed);let busy=0;const calls=[];
  const limited=()=>{const now=Date.now();while(calls.length&&calls[0]<now-60000)calls.shift();if(calls.length>=90||busy>=4)throw new PickerError('Please pause before making another selection.',429);calls.push(now);};
  const body=async req=>{let text='';for await(const chunk of req){text+=chunk;if(text.length>4096)throw new PickerError('Request too large',413);}try{return JSON.parse(text);}catch{throw new PickerError('Invalid selection request');}};
  const json=(res,status,value)=>res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(value));
  const clients=new Set(),send=()=>{const body=`data: ${JSON.stringify(feed.snapshot())}\n\n`;for(const c of clients){if(c.destroyed)continue;if(c.writableLength>4000000)c.end();else c.write(body);}};
  const server=createServer(async(req,res)=>{
    const host=req.headers.host??'';
    if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)){res.writeHead(403).end('Local access only');return;}
    if(req.headers.origin&&req.headers.origin!==`http://${host}`){res.writeHead(403).end('Local origin required');return;}
    res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const url=new URL(req.url,'http://localhost'),path=url.pathname;
    const mutation=['/api/instruments/prepare','/api/instruments/keep'].includes(path);
    if(req.method==='POST'&&mutation){
      if(req.headers.origin!==`http://${host}`||!/^application\/json(?:;|$)/i.test(req.headers['content-type']??'')){json(res,403,{error:'Same-origin JSON is required'});return;}
      let counted=false;
      try{limited();busy++;counted=true;const input=await body(req);picker.prune();
        if(path.endsWith('/keep')){if(!Array.isArray(input.keys)||input.keys.length>64||input.keys.some(k=>typeof k!=='string'||k.length>64))throw new PickerError('Invalid instrument list');for(const key of input.keys)if(feed.items.has(key))feed.leases.set(key,feed.now());json(res,200,{ok:true});}
        else{if(typeof input.key!=='string'||input.key.length>64)throw new PickerError('Invalid instrument');json(res,200,await picker.prepare(input.key));}
      }catch(error){json(res,error instanceof PickerError?error.status:503,{error:error instanceof PickerError?error.message:'Instrument check failed. Your current chart is unchanged.'});}finally{if(counted)busy--;}
      return;
    }
    if(req.method!=='GET'){res.writeHead(405,{Allow:mutation?'POST':'GET'}).end('Unsupported method');return;}
    if(path==='/api/instruments'){
      let counted=false;try{limited();busy++;counted=true;json(res,200,await picker.search(url.searchParams.get('q')??'',url.searchParams.get('provider')??'all'));}
      catch(error){json(res,error instanceof PickerError?error.status:503,{error:error instanceof PickerError?error.message:'Instrument search is temporarily unavailable.'});}finally{if(counted)busy--;}return;
    }
    if(path==='/api/state'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(feed.snapshot()));return;}
    if(path==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream',Connection:'keep-alive','X-Accel-Buffering':'no'});res.write(`retry: 3000\n\ndata: ${JSON.stringify(feed.snapshot())}\n\n`);clients.add(res);req.on('close',()=>clients.delete(res));return;}
    if(path==='/favicon.ico'){res.writeHead(204).end();return;}
    const file=files[path];if(!file){res.writeHead(404).end('Not found');return;}
    try{const bytes=await readFile(new URL(file[0],root));res.writeHead(200,{'Content-Type':file[1]}).end(bytes);}catch{res.writeHead(500).end('Required local file unavailable');}
  });
  feed.on('state',send);const heartbeat=setInterval(()=>{if(typeof feed.instruments==='function')picker.prune();send();},15000);heartbeat.unref();
  server.on('close',()=>{clearInterval(heartbeat);feed.off('state',send);feed.stop();});
  return {server,feed,picker,close:()=>{for(const c of clients)c.end();server.close();server.closeIdleConnections();}};
}
export function parseOptions(args){
  let port=4175,iex=false,publicData=false,demo=false,cboe=false;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--iex'){iex=true;publicData=true;}
    else if(args[i]==='--public')publicData=true;
    else if(args[i]==='--demo')demo=true;
    else if(args[i]==='--cboe')cboe=true;
    else if(args[i]==='--port'&&/^\d+$/.test(args[i+1]??''))port=Number(args[++i]);
    else throw Error('Unsupported option.');
  }
  if(!Number.isSafeInteger(port)||port<1024||port>65535||demo&&publicData||cboe&&!publicData)throw Error('Invalid local options.');
  return {port,iex,publicData,demo:!publicData,cboe};
}
export function createRuntime({iexFeed=null,hub=null,demo=false,cboe=false}={}){
  const state=()=>({...iexFeed.state(),capabilities:{dynamicIex:1}});
  hub??=demo?createDemoFeed():new FeedHub({cboeEnabled:cboe,iexState:iexFeed?state:null,iexSubscribe:iexFeed?async(symbol,retain)=>{
    try{await iexFeed.addSymbol(symbol,retain);return state();}
    catch(cause){const error=Error('IEX validation failed');error.status=({input:400,'no-data':404,capacity:409,busy:429,auth:403,credentials:403})[cause.code]??503;throw error;}
  }:null});
  const app=createApp({feed:hub}),update=()=>hub.refreshIex();iexFeed?.on('state',update);
  return {...app,start(){iexFeed?.start();hub.start();},close(){iexFeed?.off('state',update);iexFeed?.stop();app.close();}};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  try{
    const options=parseOptions(process.argv.slice(2));let iexFeed=null;
    if(options.iex){
      const key=process.env.APCA_API_KEY_ID,secret=process.env.APCA_API_SECRET_KEY;
      if(!key||!secret)throw Error('Private credential entry is required.');
      iexFeed=new AlpacaIexFeed({key,secret,symbols:OVERVIEW_IEX_SYMBOLS});
      delete process.env.APCA_API_KEY_ID;delete process.env.APCA_API_SECRET_KEY;
    }
    const app=createRuntime({iexFeed,demo:options.demo,cboe:options.cboe});
    app.server.listen(options.port,'127.0.0.1',()=>{console.log(`OpenChartDeck: http://127.0.0.1:${options.port} · ${options.demo?'SYNTHETIC DEMO — no market data':options.iex?'IEX requested + public sources':'public sources; IEX not configured'}`);app.start();});
    app.server.on('error',()=>{console.error('Local port unavailable. Existing services were left untouched.');app.close();process.exitCode=1;});
    for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>app.close());
  }catch{console.error('Could not start. Check documented options and use the private launcher for IEX. No credential values are logged.');process.exitCode=1;}
}
