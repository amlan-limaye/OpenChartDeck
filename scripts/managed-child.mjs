// This child can never outlive the launcher that owns its stdin pipe.
import {pathToFileURL} from 'node:url';
let stopping=false;
for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.once(signal,()=>{
  stopping=true;process.stdin.destroy();
  // Bound cleanup even if a provider request or server shutdown hangs.
  setTimeout(()=>process.exit(143),3000).unref();
});
process.stdin.once('end',()=>{if(!stopping)process.kill(process.pid,'SIGTERM');});
process.stdin.on('error',()=>{if(!stopping)process.kill(process.pid,'SIGTERM');});
process.stdin.resume();
const [target,...args]=process.argv.slice(2);
if(!target)process.exit(1);
process.argv=[process.execPath,target,...args];
await import(pathToFileURL(target).href);
delete process.env.APCA_API_KEY_ID;
delete process.env.APCA_API_SECRET_KEY;
