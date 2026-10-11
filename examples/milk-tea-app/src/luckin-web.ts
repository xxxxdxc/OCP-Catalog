import { resolve } from 'node:path';
import { startLuckinSystem } from './luckin-system';
import { errorResponse } from './catalog';
import { AppError } from './store';
import { credentialPath } from './luckin-mcp';
export function startLuckinWeb(port=5174,options:Parameters<typeof startLuckinSystem>[0]={}){
  const system=startLuckinSystem(options),publicDir=resolve(import.meta.dir,'../public');let origin='';
  const server=Bun.serve({hostname:'127.0.0.1',port,idleTimeout:120,async fetch(req){const url=new URL(req.url),path=url.pathname;try{
    if(req.headers.get('host')!==new URL(origin).host)throw new AppError('host_denied','访问地址不匹配。',403);
    if(path.startsWith('/api/')){
      if(req.method==='GET'){
        if(path==='/api/config')return Response.json({provider:'luckin',simulation:false,credential_configured:!!options.gateway||await Bun.file(credentialPath).exists(),catalog_url:system.nodes[0]!.baseUrl});
        if(path==='/api/orders')return Response.json({orders:system.listOrders(),pending:system.pendingAttempts()});
        if(path.startsWith('/api/orders/'))return Response.json(await system.getOrder(decodeURIComponent(path.slice(12))));
        if(path==='/api/trace')return Response.json(system.events);
      }
      if(req.method==='POST'){
        if(req.headers.get('origin')&&req.headers.get('origin')!==origin)throw new AppError('origin_denied','跨站请求被拒绝。',403);
        if(req.headers.get('sec-fetch-site')==='cross-site')throw new AppError('origin_denied','跨站请求被拒绝。',403);
        if(!req.headers.get('content-type')?.startsWith('application/json'))throw new AppError('invalid_json','需要 JSON 请求。');
        let body:unknown;try{body=await req.json();}catch{throw new AppError('invalid_json','JSON 内容无效。');}
        if(path==='/api/shops')return Response.json(await system.findShops(body));
        if(path==='/api/search')return Response.json(await system.search(body));
        if(path==='/api/quote')return Response.json(await system.details(body));
        if(path==='/api/orders')return Response.json(await system.createOrder(body));
      }throw new AppError('not_found','API 不存在。',404);
    }
    const files:Record<string,string>={'/':'luckin.html','/luckin.js':'luckin.js','/style.css':'style.css'};
    if(req.method!=='GET'||!files[path])throw new AppError('not_found','页面不存在。',404);
    return new Response(Bun.file(resolve(publicDir,files[path]!)),{headers:{'referrer-policy':'no-referrer','x-content-type-options':'nosniff','cache-control':'no-store'}});
  }catch(e){return errorResponse(e);}}});origin=server.url.origin;
  return {url:origin,system,close:async()=>{await server.stop(true);await system.close();}};
}
