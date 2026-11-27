// QA local: sirve nexa-v2/web y proxifica /api/* a la pasarela real (solo lectura).
// Uso: node tools/qa-proxy.mjs [port]
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,join,normalize} from 'node:path';
import {fileURLToPath} from 'node:url';

const UPSTREAM='https://nexa-5-250-184-18.nip.io';
const ROOT=fileURLToPath(new URL('../web',import.meta.url));
const PORT=Number(process.argv[2]||8787);
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json'};

http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://x');
    if(u.pathname.startsWith('/api/')){
      const t=UPSTREAM+u.pathname+u.search;
      const body=await new Promise(r=>{const c=[];req.on('data',d=>c.push(d));req.on('end',()=>r(Buffer.concat(c)));});
      const h={};for(const[k,v]of Object.entries(req.headers)){if(!['host','connection','content-length','origin','referer'].includes(k))h[k]=v;}
      const up=await fetch(t,{method:req.method,headers:h,body:['GET','HEAD'].includes(req.method)?undefined:body,redirect:'manual'});
      res.writeHead(up.status,Object.fromEntries([...up.headers].filter(([k])=>!['content-encoding','transfer-encoding','content-length','strict-transport-security'].includes(k))));
      res.end(Buffer.from(await up.arrayBuffer()));
      return;
    }
    let p=normalize(join(ROOT,u.pathname==='/'?'index.html':u.pathname));
    if(!p.startsWith(ROOT)){res.writeHead(403);return res.end();}
    const data=await readFile(p);
    res.writeHead(200,{'content-type':MIME[extname(p)]||'application/octet-stream','cache-control':'no-store'});
    res.end(data);
  }catch(e){res.writeHead(e.code==='ENOENT'?404:500);res.end(String(e.message||e));}
}).listen(PORT,()=>console.log('qa-proxy http://localhost:'+PORT+' -> '+UPSTREAM));
