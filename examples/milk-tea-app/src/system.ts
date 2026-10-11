import { OcpClient } from '@ocp-catalog/ocp-client';
import { z } from 'zod';
import { resolve } from 'node:path';
import { SHOPS, productOf } from './data';
import { TeaStore, AppError, selectionSchema, orderSchema } from './store';
import { startCatalog } from './catalog';

export const searchSchema=z.object({query:z.string().max(500).default(''),category:z.enum(['奶茶','果茶']).optional(),
  max_price_cny:z.number().nonnegative().optional(),shop_id:z.enum(['qingyu','mushan']).optional(),in_stock_only:z.boolean().default(false)}).strict();
export function startTeaSystem(options:{dbPath?:string;now?:()=>number}={}) {
  const store=new TeaStore(options.dbPath??process.env.TEA_DB_PATH??resolve(import.meta.dir,'../data/tea.sqlite'),options.now);
  const key=crypto.randomUUID(),client=new OcpClient({apiKey:key,timeoutMs:5000});
  const nodes=SHOPS.map(shop=>startCatalog(shop.id,store,key));
  const nodeFor=(entry:string)=>{const p=productOf(entry);if(!p)throw new AppError('not_found','未找到饮品。',404);return nodes.find(n=>n.shopId===p.shop_id)!;};
  const events:{id:string;time:string;step:string;shop:string;endpoint:string}[]=[];
  function trace(step:string,shop:string,endpoint:string){events.unshift({id:crypto.randomUUID(),time:new Date().toISOString(),step,shop,endpoint});if(events.length>60)events.pop();}
  return {store,nodes,events,
    async search(input:unknown){
      const args=searchSchema.parse(input),chosen=nodes.filter(n=>!args.shop_id||n.shopId===args.shop_id);
      const results=await Promise.all(chosen.map(async node=>{
        const manifest=await client.inspectCatalog(`${node.baseUrl}/ocp/manifest`);trace('manifest',node.shopId,`${node.baseUrl}/ocp/manifest`);
        const filters={...(args.category?{category:args.category}:{}),...(args.max_price_cny===undefined?{}:{max_amount:args.max_price_cny}),...(args.in_stock_only?{in_stock_only:true}:{})};
        const result=await client.queryCatalog(manifest.endpoints.query.url,{query:args.query,filters,limit:20,offset:0,explain:true});
        trace('query',node.shopId,manifest.endpoints.query.url);return result;
      }));
      return {simulation:true,shops:SHOPS,catalogs:nodes.map(n=>({shop_id:n.shopId,url:n.baseUrl})),
        entries:results.flatMap(r=>r.entries).sort((a,b)=>Number((a.entry.attributes.price as {amount:number}).amount)-Number((b.entry.attributes.price as {amount:number}).amount))};
    },
    async details(input:unknown){
      const args=selectionSchema.parse(input),node=nodeFor(args.entry_id);
      const resolved=await client.resolveCatalogEntry(`${node.baseUrl}/ocp/resolve`,{entry_id:args.entry_id,purpose:'checkout',live_check:true,requested_fields:[]});
      trace('resolve · checkout',node.shopId,`${node.baseUrl}/ocp/resolve`);
      return {resolved,quote:store.quote(args)};
    },
    async createOrder(input:unknown){
      const args=orderSchema.parse(input),quote=store.getQuote(args.quote_id),node=nodeFor(quote.entry_id);
      const resolved=await client.resolveCatalogEntry(`${node.baseUrl}/ocp/resolve`,{entry_id:quote.entry_id,purpose:'checkout',live_check:true,requested_fields:[]});
      trace('resolve · checkout',node.shopId,`${node.baseUrl}/ocp/resolve`);
      // Already-created orders must remain retrievable on retries even if the last cup sold out.
      const action=resolved.action_bindings.find(a=>a.action_id==='create_order');
      const expected=`${node.baseUrl}/shop/orders`;
      if(!action) {
        if(store.orderForQuote(args.quote_id))return store.createOrder(args);
        throw new AppError('sold_out','门店未提供可执行下单动作，饮品可能已售罄。',409);
      }
      if(action&&(action.entrypoint.url!==expected||action.entrypoint.method!=='POST'))throw new AppError('invalid_action','下单动作地址不可信。');
      const r=await fetch(action.entrypoint.url,{method:'POST',headers:{'content-type':'application/json','x-api-key':key},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});
      const value=await r.json() as {error?:{code:string;message:string}};
      if(!r.ok)throw new AppError(value.error?.code??'order_failed',value.error?.message??'下单失败。',r.status);
      trace('business · order',node.shopId,expected);return value;
    },
    getOrder:(id:string)=>store.getOrder(id),
    close:async()=>{await Promise.all(nodes.map(n=>n.close()));store.close();},
  };
}
export type TeaSystem=ReturnType<typeof startTeaSystem>;
