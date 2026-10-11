import { catalogManifestSchema, catalogQueryRequestSchema, resolveRequestSchema } from '@ocp-catalog/ocp-schema';
import { validateCatalogQueryRequest } from '@ocp-catalog/ocp-client';
import { z } from 'zod';
import { SHOPS, PRODUCTS, entryId, productOf, SIZES, SUGARS, ICES, ADDONS, type ShopId } from './data';
import { TeaStore, AppError, orderSchema } from './store';
const response = (data: unknown, status=200) => Response.json(data,{status});
export function errorResponse(error: unknown) {
  if (error instanceof AppError) return response({error:{code:error.code,message:error.message}},error.status);
  if (error instanceof z.ZodError) return response({error:{code:'invalid_input',message:'输入不符合约定。',details:error.issues}},400);
  if (error instanceof Error && error.name==='OcpClientValidationError') return response({error:{code:'unsupported_query',message:error.message}},400);
  console.error(error); return response({error:{code:'internal_error',message:'服务暂时无法完成请求。'}},500);
}
export function startCatalog(shopId: ShopId, store: TeaStore, apiKey: string) {
  const shop=SHOPS.find(s=>s.id===shopId)!; let base=''; const catalogId=`tea_${shopId}`;
  const updatedAt=new Date().toISOString();
  function manifest() {
    return catalogManifestSchema.parse({ocp_version:'1.0',kind:'CatalogManifest',id:`manifest_${shopId}`,catalog_id:catalogId,
      catalog_name:shop.name,description:'独立模拟奶茶店目录，价格为中杯基础价，订单不涉及付款。',
      endpoints:{query:{url:`${base}/ocp/query`,method:'POST'},resolve:{url:`${base}/ocp/resolve`,method:'POST'},
        health:{url:`${base}/ocp/health`,method:'GET'},contracts:{url:`${base}/ocp/contracts`,method:'GET'}},
      query_capabilities:[{capability_id:'tea.menu.search',query_packs:[
        {pack_id:'ocp.query.keyword.v1',query_modes:['keyword']},
        {pack_id:'demo.tea.filter.v1',query_modes:['filter','hybrid']}],
        input_fields:[{name:'filters.category'},{name:'filters.max_amount'},{name:'filters.in_stock_only'}],
        supports_explain:true,supports_resolve:true}],object_contracts:[]});
  }
  const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
    const url=new URL(req.url),path=url.pathname;
    try {
      if(path.startsWith('/shop/')&&req.headers.get('x-api-key')!==apiKey) throw new AppError('unauthorized','下单接口需要本地授权。',401);
      if(req.method==='GET') {
        if(path==='/.well-known/ocp-catalog') return response({ocp_version:'1.0',kind:'WellKnownCatalogDiscovery',catalog_id:catalogId,catalog_name:shop.name,
          manifest_url:`${base}/ocp/manifest`,health_url:`${base}/ocp/health`,contracts_url:`${base}/ocp/contracts`,query_url:`${base}/ocp/query`,resolve_url:`${base}/ocp/resolve`});
        if(path==='/ocp/manifest')return response(manifest());
        if(path==='/ocp/health')return response({ocp_version:'1.0',kind:'CatalogHealth',catalog_id:catalogId,status:'healthy',ready:true,checked_at:new Date().toISOString()});
        if(path==='/ocp/contracts')return response({ocp_version:'1.0',kind:'ObjectContractList',catalog_id:catalogId,object_contracts:[]});
        if(path.startsWith('/shop/quotes/')) {const q=store.getQuote(decodeURIComponent(path.slice(13)));if(q.shop_id!==shopId)throw new AppError('not_found','门店报价不存在。',404);return response(q);}
      }
      if(req.method==='POST') {
        let body:unknown;try{body=await req.json();}catch{throw new AppError('invalid_json','需要有效 JSON。');}
        if(path==='/ocp/query') {
          const args=catalogQueryRequestSchema.parse(body);
          if(args.catalog_id&&args.catalog_id!==catalogId)throw new AppError('wrong_catalog','目录标识不匹配。');
          if(args.cursor)throw new AppError('unsupported_cursor','本示例不支持游标翻页。');
          const policy=validateCatalogQueryRequest(manifest(),args).policy_summary;
          const raw=args.query.trim().toLowerCase();
          // Deterministic intent hints, not semantic or LLM search. Sweetness is selected at quote time.
          const term=raw.includes('果茶')?'果茶':raw.includes('珍珠奶茶')?'珍珠':raw;
          const matches=PRODUCTS.filter(p=>p.shop_id===shopId&&(!term||`${p.title} ${p.category} ${p.summary}`.toLowerCase().includes(term))
            &&(!args.filters.category||p.category===args.filters.category)&&(!args.filters.in_stock_only||store.stock(entryId(p))>0)
            &&(args.filters.max_amount===undefined||p.cents<=args.filters.max_amount*100));
          // This bounded example has four products per shop; reject truncation instead of lying about pagination.
          if(matches.length>args.limit)throw new AppError('limit_too_small','本示例不支持分页，请提高 limit 以接收全部匹配项。');
          return response({ocp_version:'1.0',kind:'CatalogQueryResult',id:`qry_${crypto.randomUUID()}`,catalog_id:catalogId,
            query_pack:policy.selected_query_pack,query_mode:policy.query_mode,query:args.query,result_count:matches.length,
            page:{limit:args.limit,offset:0,has_more:false},policy_summary:policy,
            entries:matches.map(p=>({score:1,explain:[`匹配「${term||'全部饮品'}」，中杯基础价 ¥${p.cents/100}。`],entry:{
              kind:'CatalogEntry',catalog_id:catalogId,entry_id:entryId(p),provider_id:shopId,object_id:p.id,object_type:'ocp.commerce.product',title:p.title,summary:p.summary,
              attributes:{shop,category:p.category,price:{currency:'CNY',amount:p.cents/100},inventory:{availability_status:store.stock(entryId(p))?'in_stock':'out_of_stock'},
                large_surcharge_cny:p.large_cents/100,colors:p.colors,icon:p.icon,options:{sizes:SIZES,sugars:SUGARS,ices:Object.fromEntries(Object.entries(ICES).filter(([key])=>key!=='hot'||p.hot)),
                addons:Object.fromEntries(p.addons.map(a=>[a,ADDONS[a]]))}}}}))});
        }
        if(path==='/ocp/resolve') {
          const args=resolveRequestSchema.parse(body),p=productOf(args.entry_id);
          if(!p||p.shop_id!==shopId)throw new AppError('not_found','该门店找不到这款饮品。',404);
          const expires=new Date(Date.now()+300000).toISOString();
          const available=store.stock(args.entry_id)>0;
          return response({ocp_version:'1.0',kind:'ResolvableReference',id:`res_${crypto.randomUUID()}`,catalog_id:catalogId,
            entry_id:args.entry_id,commercial_object_id:`co_${shopId}_${p.id}`,object_id:p.id,object_type:'ocp.commerce.product',provider_id:shopId,title:p.title,
            visible_attributes:{shop,base_price_cny:p.cents/100,available,simulation:true},
            action_bindings:args.purpose==='view'?[{action_id:'view',action_type:'url',label:'查看饮品详情',entrypoint:{url:`${base}/products/${p.id}`,method:'GET'},requires_user_confirmation:false}]
              :args.purpose==='checkout'&&available?[{action_id:'create_order',action_type:'api',label:'确认模拟奶茶订单',entrypoint:{url:`${base}/shop/orders`,method:'POST'},
                input_schema:z.toJSONSchema(orderSchema),requires_user_confirmation:true,expires_at:expires,auth_requirements:{header:'x-api-key'}}]:[],
            live_checks:[{check_id:'stock',status:available?'passed':'failed',checked_at:new Date().toISOString(),summary:available?'可售':'售罄'}],
            freshness:{object_updated_at:updatedAt,resolved_at:new Date().toISOString()},expires_at:expires});
        }
        if(path==='/shop/orders') {
          const args=orderSchema.parse(body),quote=store.getQuote(args.quote_id);
          if(quote.shop_id!==shopId)throw new AppError('wrong_shop','报价所属门店不匹配。');
          return response(store.createOrder(args));
        }
      }
      if(req.method==='GET'&&path.startsWith('/products/')) {
        const p=PRODUCTS.find(p=>p.shop_id===shopId&&p.id===path.slice(10));
        if(!p)throw new AppError('not_found','商品不存在。',404);
        return new Response(`<!doctype html><meta charset="utf-8"><title>${p.title}</title><h1>${p.title}</h1><p>${p.summary}</p><p>中杯基础价 ¥${p.cents/100} · ${shop.name} · 模拟商品</p>`,{headers:{'content-type':'text/html; charset=utf-8'}});
      }
      throw new AppError('not_found','接口不存在。',404);
    }catch(e){return errorResponse(e);}
  }});
  base=server.url.origin;
  return {baseUrl:base,shopId,manifest,close:()=>server.stop(true)};
}
