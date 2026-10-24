// Only constructed status, used by lifecycle tests. No provider requests.
import {createServer} from 'node:http';
const [port,kind='normal',delay='0']=process.argv.slice(2),start=Date.now(),credentialPresent=Boolean(process.env.APCA_API_SECRET_KEY);
const server=createServer((req,res)=>{
  res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({ready:Date.now()-start>=Number(delay),credentialPresent,pid:process.pid}));
});
server.listen(Number(port),'127.0.0.1');
for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.on(signal,()=>{server.close();server.closeAllConnections();});
if(kind==='crash')setTimeout(()=>process.exit(9),300);
