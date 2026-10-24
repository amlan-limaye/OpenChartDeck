// Scans this candidate and its own Git objects only. Never prints matched values.
import {readdir,readFile,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url)),manifest=[],issues=[];
const dirs=new Set(['public','lib','scripts','test','launchers','docs','licenses','examples','.github']);
const rootFiles=new Set(['server.mjs','package.json','package-lock.json','.gitignore','.env.example','README.md','SECURITY.md','PRIVACY.md','THIRD_PARTY.md','LICENSE-DECISION.md','NOTICE','LICENSE','CONTRIBUTING.md']);
const patterns=[
 ['private path',new RegExp('/'+'(?:Users|home)'+'/')],
 ['possible Alpaca/AWS key',/\b(?:AK|PK|AKIA|ASIA)[A-Z0-9]{18,}\b/],
 ['possible GitHub token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/],
 ['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
 ['possible JWT',/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/],
 ['credential literal',/(?:secret|password|api_key)\s*[:=]\s*["'][A-Za-z0-9/+_=.-]{24,}["']/i],
];
function inspect(name,bytes,scope){
 if(/\.(?:png|jpe?g|webp|csv|parquet|har|sqlite\w*|zip|tgz|log|pem|key)$/i.test(name)||(/(?:^|\/)\.env/.test(name)&&name!=='.env.example'))issues.push({scope,file:name,reason:'private/data/binary artifact'});
 const content=bytes.toString('utf8');
 if(bytes.includes(0))issues.push({scope,file:name,reason:'binary content'});
 for(const [reason,pattern]of patterns)if(pattern.test(content))issues.push({scope,file:name,reason});
}
async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
 if(['node_modules','.git','__pycache__'].includes(entry.name))continue;
 const path=join(dir,entry.name),name=relative(root,path).replaceAll('\\','/');
 if((await lstat(path)).isSymbolicLink()){issues.push({file:name,reason:'symlink'});continue;}
 if(entry.isDirectory()){if(!dirs.has(name.split('/')[0]))issues.push({file:name,reason:'unexpected directory'});else await walk(path);continue;}
 if(!name.includes('/')&&!rootFiles.has(name))issues.push({file:name,reason:'unexpected root file'});
 const bytes=await readFile(path);inspect(name,bytes,'working-tree');manifest.push({file:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}}
await walk(root);
let gitPresent=false,stagedFiles=0,historyCommits=0,historyBlobs=0;
try{gitPresent=(await lstat(join(root,'.git'))).isDirectory();}catch{}
if(gitPresent){
 const git=args=>execFileSync('git',['-c','core.fsmonitor=false',...args],{cwd:root,maxBuffer:16000000});
 for(const line of git(['ls-files','--stage','-z']).toString().split('\0').filter(Boolean)){
  const [meta,name]=line.split('\t'),[mode,oid]=meta.split(' ');stagedFiles++;
  if(!['100644','100755'].includes(mode)){issues.push({scope:'index',file:name,reason:'non-regular Git entry'});continue;}
  if(!manifest.some(m=>m.file===name))issues.push({scope:'index',file:name,reason:'outside reviewed manifest'});
  inspect(name,git(['cat-file','blob',oid]),'index');
 }
 const commits=git(['rev-list','--all']).toString().trim().split('\n').filter(Boolean);historyCommits=commits.length;
 for(const oid of commits)inspect('commit '+oid,git(['cat-file','commit',oid]),'history');
 if(commits.length)for(const line of git(['rev-list','--objects','--all']).toString().trim().split('\n')){
  const at=line.indexOf(' ');if(at<0)continue;const oid=line.slice(0,at),name=line.slice(at+1);
  if(git(['cat-file','-t',oid]).toString().trim()!=='blob')continue;
  historyBlobs++;inspect(name,git(['cat-file','blob',oid]),'history');
 }
}
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
console.log(JSON.stringify({filesChecked:manifest.length,manifest:manifest.sort((a,b)=>a.file.localeCompare(b.file)),issues,git:{present:gitPresent,stagedFiles,historyCommits,historyBlobs},originalLicenseSelected:pkg.license!=='UNLICENSED',publicationReady:issues.length===0&&pkg.license!=='UNLICENSED'},null,2));
if(issues.length)process.exitCode=1;
