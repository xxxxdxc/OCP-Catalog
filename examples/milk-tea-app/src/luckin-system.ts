import { OcpClient, validateCatalogQueryRequest } from '@ocp-catalog/ocp-client';
import { catalogManifestSchema,catalogQueryRequestSchema,resolveRequestSchema } from '@ocp-catalog/ocp-schema';
import { Database } from 'bun:sqlite';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { z } from 'zod';
import { AppError } from './store';
import { errorResponse } from './catalog';
import { RemoteLuckin,type LuckinGateway } from './luckin-mcp';

const locationSchema=z.object({longitude:z.number().min(-180).max(180),latitude:z.number().min(-90).max(90),deptName:z.string().max(100).optional()}).strict();
const searchSchema=z.object({shop_id:z.number().int().positive(),query:z.string().max(500).default('咖啡')}).strict();
const selectionSchema=z.object({entry_id:z.string(),quantity:z.number().int().min(1).max(5).default(1),attributes:z.array(z.object({group:z.number().int(),value:z.number().int()}).strict()).max(30).default([])}).strict();
const orderSchema=z.object({quote_id:z.string().uuid(),expected_total_cents:z.number().int().nonnegative(),user_confirmed:z.literal(true),idempotency_key:z.string().uuid()}).strict();
export const statusLabels:Record<number,string>={10:'待付款',20:'下单成功',30:'制作中',60:'等待取餐',80:'已完成',100:'已取消'};
function cents(value:any){if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new AppError('invalid_price','瑞幸未提供可确认的金额。',502);return Math.round(value*100);}
function product(value:any){if(!value||!Number.isSafeInteger(value.productId)||typeof value.skuCode!=='string'||!value.skuCode)throw new AppError('invalid_product','瑞幸商品缺少有效 SKU。',502);return value;}
function safeUrl(value:any,payment=false){if(typeof value!=='string')return undefined;try{const u=new URL(value);return (u.protocol==='https:'&&!u.username&&!u.password)||payment&&u.protocol==='weixin:'?value:undefined;}catch{return undefined;}}
export function startLuckinSystem(options:{gateway?:LuckinGateway;dbPath?:string;now?:()=>number}={}){
  const gateway=options.gateway??new RemoteLuckin(),now=options.now??Date.now;
  const dbPath=options.dbPath??resolve(import.meta.dir,'../data/luckin.sqlite');if(dbPath!==':memory:')mkdirSync(resolve(dbPath,'..'),{recursive:true});
  const db=new Database(dbPath);db.run('PRAGMA journal_mode=WAL');
  db.run('CREATE TABLE IF NOT EXISTS luckin_quotes (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
  // Persist a submitting marker BEFORE network I/O. Unknown outcomes are never automatically retried.
  db.run('CREATE TABLE IF NOT EXISTS luckin_attempts (quote_id TEXT PRIMARY KEY, idem TEXT UNIQUE NOT NULL, state TEXT NOT NULL, data TEXT)');
  const shops=new Map<number,any>(),products=new Map<string,any>();let location:{longitude:number;latitude:number}|undefined;
  const events:{id:string;time:string;step:string;shop:string;endpoint:string}[]=[];
  function trace(step:string,shop:string,endpoint:string){events.unshift({id:crypto.randomUUID(),time:new Date(now()).toISOString(),step,shop,endpoint});if(events.length>60)events.pop();}
  async function call(name:string,args:Record<string,unknown>){trace('MCP · '+name,String(args.deptId??''),'瑞幸远程 MCP');return gateway.call(name,args);}
  const catalogId='luckin_personal';let base='';const actionKey=crypto.randomUUID();
  const client=new OcpClient({apiKey:actionKey,timeoutMs:60000});
  function manifest(){return catalogManifestSchema.parse({ocp_version:'1.0',kind:'CatalogManifest',id:'manifest_luckin',catalog_id:catalogId,catalog_name:'瑞幸 · 个人门店目录',
    description:'真实瑞幸门店；query 返回商品投影，resolve 返回业务动作，需用户确认下单。',
    endpoints:{query:{url:base+'/ocp/query',method:'POST'},resolve:{url:base+'/ocp/resolve',method:'POST'},health:{url:base+'/ocp/health',method:'GET'},contracts:{url:base+'/ocp/contracts',method:'GET'}},
    query_capabilities:[{capability_id:'luckin.menu.search',query_packs:[{pack_id:'ocp.query.keyword.v1',query_modes:['keyword']},{pack_id:'demo.luckin.store.v1',query_modes:['filter','hybrid']}],input_fields:[{name:'filters.provider_id',required:true}],supports_resolve:true,supports_explain:true}],object_contracts:[]});}
  function entry(p:any,deptId:number){return {kind:'CatalogEntry',catalog_id:catalogId,entry_id:`luckin:${deptId}:${p.productId}`,provider_id:String(deptId),object_id:String(p.productId),object_type:'ocp.commerce.product',title:p.productName??'瑞幸饮品',summary:(p.tags??[]).join(' · '),
    attributes:{shop:shops.get(deptId),picture_url:safeUrl(p.pictureUrl),price:{currency:'CNY',amount:typeof p.estimatePrice==='number'?p.estimatePrice:null,estimated:true},options:p.productAttrs??[]}};}
  function storedQuote(id:string){const row=db.query('SELECT data FROM luckin_quotes WHERE id=?').get(id) as {data:string}|null;if(!row)throw new AppError('quote_missing','报价不存在，请重新选择饮品。',404);return JSON.parse(row.data);}
  async function submit(input:unknown){
    const args=orderSchema.parse(input),q=storedQuote(args.quote_id);
    if(q.total_cents!==args.expected_total_cents)throw new AppError('price_mismatch','确认金额不匹配，请重新报价。',409);
    const prior=db.query('SELECT * FROM luckin_attempts WHERE quote_id=? OR idem=?').get(q.quote_id,args.idempotency_key) as any;
    if(prior){if(prior.quote_id!==q.quote_id)throw new AppError('key_reused','请求标识已使用。',409);if(prior.state==='complete')return JSON.parse(prior.data);throw new AppError('order_uncertain','该订单正在提交或结果未知，请先在瑞幸 App 检查，不要重复下单。',409);}
    if(q.expires_ms<=now())throw new AppError('quote_expired','报价已过期，请重新获取。',409);
    // Recheck upstream before the irreversible action, including coupon choice and selected SKU.
    const fresh=await call('previewOrder',{deptId:q.dept_id,productList:q.productList});
    if(cents(fresh.discountPrice)!==q.total_cents||JSON.stringify(fresh.couponCodeList??[])!==JSON.stringify(q.coupons))throw new AppError('price_changed','瑞幸价格或优惠已变化，请重新报价并确认。',409);
    try{db.run('INSERT INTO luckin_attempts VALUES (?,?,?,NULL)',[q.quote_id,args.idempotency_key,'submitting']);}catch{throw new AppError('duplicate_order','订单已提交，请查看我的订单或瑞幸 App。',409);}
    try{
      const result=await call('createOrder',{deptId:q.dept_id,productList:q.productList,...q.location,couponCodeList:q.coupons});
      const id=typeof result.orderIdStr==='string'?result.orderIdStr:typeof result.orderId==='string'?result.orderId:Number.isSafeInteger(result.orderId)?String(result.orderId):undefined;
      if(!id)throw new AppError('order_uncertain','瑞幸返回订单号不可识别，请在瑞幸 App 查看。',502);
      const order={order_id:id,title:q.title,shop_name:q.shop_name,shop_address:q.shop_address,selection_label:q.selection_label,quantity:q.quantity,total_cents:typeof result.discountPrice==='number'?cents(result.discountPrice):q.total_cents,
        need_pay:result.needPay,pay_url:safeUrl(result.payOrderUrl,true),pay_qr_url:safeUrl(result.payOrderQrCodeUrl),status_label:'已创建，待查询真实状态',created_at:new Date(now()).toISOString()};
      db.run('UPDATE luckin_attempts SET state=?,data=? WHERE quote_id=?',['complete',JSON.stringify(order),q.quote_id]);return order;
    }catch{db.run('UPDATE luckin_attempts SET state=? WHERE quote_id=?',['unknown',q.quote_id]);throw new AppError('order_uncertain','提交结果未知。请先在瑞幸 App 检查订单，勿重复提交。',502);}
  }
  const node=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){const path=new URL(req.url).pathname;try{
    if(req.method==='GET'){
      if(path==='/.well-known/ocp-catalog')return Response.json({ocp_version:'1.0',kind:'WellKnownCatalogDiscovery',catalog_id:catalogId,catalog_name:'瑞幸',manifest_url:base+'/ocp/manifest',query_url:base+'/ocp/query',resolve_url:base+'/ocp/resolve',health_url:base+'/ocp/health',contracts_url:base+'/ocp/contracts'});
      if(path==='/ocp/manifest')return Response.json(manifest());
      if(path==='/ocp/contracts')return Response.json({ocp_version:'1.0',kind:'ObjectContractList',catalog_id:catalogId,object_contracts:[]});
      if(path==='/ocp/health')return Response.json({ocp_version:'1.0',kind:'CatalogHealth',catalog_id:catalogId,status:'healthy',ready:true,checked_at:new Date(now()).toISOString()});
      if(path.startsWith('/products/')){const saved=products.get(decodeURIComponent(path.slice(10)));if(!saved)throw new AppError('product_missing','请重新查询商品。',404);return Response.json({shop:shops.get(saved.deptId),product:await call('queryProductDetailInfo',{deptId:saved.deptId,productId:saved.p.productId})});}
    }
    if(req.method==='POST'){
      if(path==='/shop/orders'){if(req.headers.get('x-api-key')!==actionKey)throw new AppError('unauthorized','下单需要后端授权。',401);return Response.json(await submit(await req.json()));}
      if(path==='/ocp/query'){
        const args=catalogQueryRequestSchema.parse(await req.json());
        if(args.catalog_id&&args.catalog_id!==catalogId)throw new AppError('wrong_catalog','目录标识不匹配。');
        if(args.cursor)throw new AppError('unsupported_cursor','瑞幸接口不支持游标。');
        if(Object.keys(args.filters).some(k=>k!=='provider_id'))throw new AppError('unsupported_filter','此适配器仅支持 provider_id 门店筛选。');
        const policy=validateCatalogQueryRequest(manifest(),args).policy_summary,deptId=Number(args.filters.provider_id);
        if(!shops.has(deptId))throw new AppError('shop_missing','请先选择已查询到的门店。');
        const list=await call('searchProductForMcp',{deptId,query:args.query||'咖啡'});
        if(!Array.isArray(list))throw new AppError('invalid_menu','瑞幸菜单返回格式异常。',502);
        if(list.length>args.limit)throw new AppError('limit_too_small','请提高查询 limit，瑞幸不提供分页。');
        const entries=list.map(v=>{const p=product(v),e=entry(p,deptId);products.set(e.entry_id,{p,deptId});return {entry:e,score:1,explain:['瑞幸 MCP 推荐结果；金额为预估，最终以订单预览为准。']};});
        return Response.json({ocp_version:'1.0',kind:'CatalogQueryResult',id:'qry_'+crypto.randomUUID(),catalog_id:catalogId,query_pack:policy.selected_query_pack,query_mode:policy.query_mode,query:args.query,result_count:entries.length,page:{limit:args.limit,offset:0,has_more:false},policy_summary:policy,entries});
      }
      if(path==='/ocp/resolve'){
        const args=resolveRequestSchema.parse(await req.json()),saved=products.get(args.entry_id);if(!saved)throw new AppError('product_missing','请重新搜索饮品。',404);
        const p=product(await call('queryProductDetailInfo',{deptId:saved.deptId,productId:saved.p.productId}));
        const expires=new Date(now()+120000).toISOString();
        return Response.json({ocp_version:'1.0',kind:'ResolvableReference',id:'res_'+crypto.randomUUID(),catalog_id:catalogId,entry_id:args.entry_id,commercial_object_id:args.entry_id,object_id:String(p.productId),object_type:'ocp.commerce.product',provider_id:String(saved.deptId),title:p.productName,
          visible_attributes:{product:p,shop:shops.get(saved.deptId)},action_bindings:args.purpose==='checkout'?[{action_id:'create_order',action_type:'api',label:'确认瑞幸真实下单',entrypoint:{url:base+'/shop/orders',method:'POST'},input_schema:z.toJSONSchema(orderSchema),requires_user_confirmation:true,expires_at:expires,auth_requirements:{header:'x-api-key'}}]:args.purpose==='view'?[{action_id:'view',action_type:'url',label:'查看饮品',entrypoint:{url:base+'/products/'+encodeURIComponent(args.entry_id),method:'GET'},requires_user_confirmation:false}]:[],
          live_checks:[{check_id:'detail',status:'passed',checked_at:new Date(now()).toISOString(),summary:'已读取瑞幸实时商品详情'}],freshness:{object_updated_at:new Date(now()).toISOString(),resolved_at:new Date(now()).toISOString()},expires_at:expires});
      }
    }throw new AppError('not_found','接口不存在。',404);
  }catch(e){return errorResponse(e);}}});base=node.url.origin;
  return {events,nodes:[{shopId:'luckin',baseUrl:base}],manifest,
    async findShops(input:unknown){const args=locationSchema.parse(input),list=await call('queryShopList',args);if(!Array.isArray(list))throw new AppError('invalid_shops','瑞幸门店返回格式异常。',502);
      location={longitude:args.longitude,latitude:args.latitude};shops.clear();products.clear();for(const s of list){if(Number.isSafeInteger(s.deptId))shops.set(s.deptId,s);}return {shops:[...shops.values()]};},
    async search(input:unknown){const args=searchSchema.parse(input);await client.inspectCatalog(base+'/ocp/manifest');trace('OCP · manifest',String(args.shop_id),base+'/ocp/manifest');
      const result=await client.queryCatalog(base+'/ocp/query',{query:args.query,filters:{provider_id:String(args.shop_id)},limit:50,offset:0,explain:true});trace('OCP · query',String(args.shop_id),base+'/ocp/query');return {simulation:false,entries:result.entries};},
    async details(input:unknown){const args=selectionSchema.parse(input);const saved=products.get(args.entry_id);if(!saved||!location)throw new AppError('product_missing','请先定位、选店和搜索饮品。');
      const resolved=await client.resolveCatalogEntry(base+'/ocp/resolve',{entry_id:args.entry_id,purpose:'checkout',live_check:true,requested_fields:[]});trace('OCP · resolve',String(saved.deptId),base+'/ocp/resolve');
      let p=product(resolved.visible_attributes.product);
      for(const a of args.attributes){const g=(p.productAttrs??[]).find((g:any)=>g.attributeId===a.group),v=g?.productSubAttrs?.find((v:any)=>v.attributeId===a.value);if(!v||v.canSelected===0)throw new AppError('invalid_option','此规格不可选，请重新选择。');
        p=product(await call('switchProduct',{deptId:saved.deptId,productId:p.productId,skuCode:p.skuCode,attrOperationParam:{attributeId:a.group,subAttr:{attributeId:a.value,operation:3}},amount:args.quantity}));}
      // If constraints changed another selected group, do not silently order a different configuration.
      for(const a of args.attributes){const g=(p.productAttrs??[]).find((g:any)=>g.attributeId===a.group);if(!g?.productSubAttrs?.some((v:any)=>v.attributeId===a.value&&v.selected===true))throw new AppError('options_changed','规格组合不可同时使用，请调整选择。');}
      const productList=[{amount:args.quantity,productId:p.productId,skuCode:p.skuCode}],preview=await call('previewOrder',{deptId:saved.deptId,productList});
      const shop=shops.get(saved.deptId),quote={quote_id:crypto.randomUUID(),entry_id:args.entry_id,dept_id:saved.deptId,title:p.productName,shop_name:shop.deptName,shop_address:shop.address,quantity:args.quantity,productList,location:{...location},coupons:preview.couponCodeList??[],total_cents:cents(preview.discountPrice),
        selection_label:preview.productInfoList?.map((p:any)=>p.additionDesc).filter(Boolean).join(' · ')||(p.productAttrs??[]).flatMap((g:any)=>g.productSubAttrs?.filter((v:any)=>v.selected).map((v:any)=>v.attributeName)??[]).join(' · '),
        expires_ms:now()+120000,expires_at:new Date(now()+120000).toISOString(),about_time:preview.aboutTime};
      db.run('INSERT INTO luckin_quotes VALUES (?,?)',[quote.quote_id,JSON.stringify(quote)]);return {resolved,product:p,quote};},
    async createOrder(input:unknown){const args=orderSchema.parse(input),q=storedQuote(args.quote_id);
      const prior=db.query('SELECT quote_id,state,data FROM luckin_attempts WHERE quote_id=? OR idem=?').get(args.quote_id,args.idempotency_key) as any;
      if(prior){if(prior.quote_id!==q.quote_id||q.total_cents!==args.expected_total_cents)throw new AppError('key_reused','确认金额或请求标识不匹配。',409);if(prior.state==='complete')return JSON.parse(prior.data);throw new AppError('order_uncertain','该订单提交结果未知，请先在瑞幸 App 检查。',409);}
      const resolved=await client.resolveCatalogEntry(base+'/ocp/resolve',{entry_id:q.entry_id,purpose:'checkout',live_check:true,requested_fields:[]});
      const action=resolved.action_bindings.find(a=>a.action_id==='create_order');if(!action||action.entrypoint.url!==base+'/shop/orders'||action.entrypoint.method!=='POST'||!action.requires_user_confirmation)throw new AppError('invalid_action','OCP 未提供可信下单动作。');
      const res=await fetch(action.entrypoint.url,{method:'POST',headers:{'content-type':'application/json','x-api-key':actionKey},body:JSON.stringify(args),signal:AbortSignal.timeout(60000)}),value=await res.json() as any;trace('OCP · business order',q.shop_name,base+'/shop/orders');if(!res.ok)throw new AppError(value.error?.code??'order_failed',value.error?.message??'下单失败。',res.status);return value;},
    listOrders(){return (db.query("SELECT data FROM luckin_attempts WHERE state='complete' ORDER BY rowid DESC").all() as {data:string}[]).map(r=>JSON.parse(r.data));},
    pendingAttempts(){return (db.query("SELECT quote_id,state FROM luckin_attempts WHERE state!='complete'").all());},
    async getOrder(id:string){const order=this.listOrders().find((o:any)=>o.order_id===id);if(!order)throw new AppError('order_missing','本机未记录此订单。',404);const detail=await call('queryOrderDetailInfo',{orderId:id});return {...order,status:detail.orderStatus,status_label:detail.orderStatusName??statusLabels[detail.orderStatus]??'未知状态',pickup_code:detail.takeMealCodeInfo?.code??'',about_time:detail.aboutTime};},
    close:async()=>{await node.stop(true);await gateway.close();db.close();},
  };
}
