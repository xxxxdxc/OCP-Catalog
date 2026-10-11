import { resolve } from 'node:path';
import { startTeaSystem } from './system';
import { AppError } from './store';
import { errorResponse } from './catalog';
import { startLuckinWeb } from './luckin-web';

export function startTeaWeb(port=5174,dbPath?:string) {
  const system=startTeaSystem({dbPath}),publicDir=resolve(import.meta.dir,'../public');let origin='';
  const server=Bun.serve({hostname:'127.0.0.1',port,async fetch(req){
    const url=new URL(req.url),path=url.pathname;
    try {
      if(path.startsWith('/api/')) {
        if(req.method==='GET') {
          if(path==='/api/menu')return Response.json(await system.search(Object.fromEntries(url.searchParams)));
          if(path==='/api/orders')return Response.json(system.store.listOrders());
          if(path.startsWith('/api/orders/'))return Response.json(system.getOrder(decodeURIComponent(path.slice(12))));
          if(path==='/api/trace')return Response.json(system.events);
        }
        if(req.method==='POST') {
          if(req.headers.get('origin')&&req.headers.get('origin')!==origin)throw new AppError('origin_denied','跨站请求被拒绝。',403);
          if(!req.headers.get('content-type')?.startsWith('application/json'))throw new AppError('invalid_json','需要 JSON 请求。');
          let body:unknown;try{body=await req.json();}catch{throw new AppError('invalid_json','JSON 内容无效。');}
          if(path==='/api/search')return Response.json(await system.search(body));
          if(path==='/api/quote')return Response.json(await system.details(body));
          if(path==='/api/orders')return Response.json(await system.createOrder(body));
        }
        throw new AppError('not_found','API 不存在。',404);
      }
      if(req.method!=='GET')throw new AppError('not_found','接口不存在。',404);
      const allowed:Record<string,string>={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
      const file=allowed[path];if(!file)throw new AppError('not_found','页面不存在。',404);
      return new Response(Bun.file(resolve(publicDir,file)));
    }catch(error){return errorResponse(error);}
  }});origin=server.url.origin;
  return {url:origin,system,close:async()=>{await server.stop(true);await system.close();}};
}
if(import.meta.main){
  const web=process.env.TEA_PROVIDER==='mock'?startTeaWeb(Number(process.env.TEA_WEB_PORT??5174)):startLuckinWeb(Number(process.env.TEA_WEB_PORT??5174));
  console.log(`饮品点单 · ${process.env.TEA_PROVIDER==='mock'?'模拟':'瑞幸真实接入'}：${web.url}`);
  for(const node of web.system.nodes)console.log(`${node.shopId} OCP Catalog: ${node.baseUrl}`);
  const close=async()=>{await web.close();process.exit(0);};process.on('SIGINT',close);process.on('SIGTERM',close);
}
