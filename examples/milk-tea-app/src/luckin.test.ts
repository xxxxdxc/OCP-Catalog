import { test,expect } from 'bun:test';
import { startLuckinSystem } from './luckin-system';
import { startLuckinWeb } from './luckin-web';
import { catalogQueryResultSchema,resolvableReferenceSchema } from '@ocp-catalog/ocp-schema';
import { type LuckinGateway } from './luckin-mcp';
import { mkdtempSync,unlinkSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixtureLuckin } from './luckin-fixture';
test('restart preserves completed and uncertain orders without new upstream creation',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ocp-luckin-qa-')),dbPath=join(dir,'fixture.sqlite'),gateway=new FixtureLuckin();let s=startLuckinSystem({gateway,dbPath});
  try{
    await s.findShops({longitude:120,latitude:30});const id=(await s.search({shop_id:123})).entries[0]!.entry.entry_id;
    const q=(await s.details({entry_id:id})).quote,args={quote_id:q.quote_id,expected_total_cents:q.total_cents,user_confirmed:true as const,idempotency_key:crypto.randomUUID()},order=await s.createOrder(args);
    const q2=(await s.details({entry_id:id})).quote,args2={...args,quote_id:q2.quote_id,idempotency_key:crypto.randomUUID()};gateway.unknown=true;await expect(s.createOrder(args2)).rejects.toThrow('结果未知');
    await s.close();s=startLuckinSystem({gateway,dbPath});expect(await s.createOrder(args)).toEqual(order);await expect(s.createOrder(args2)).rejects.toThrow('结果未知');expect(gateway.calls.filter(c=>c.name==='createOrder')).toHaveLength(2);expect(s.listOrders()).toHaveLength(1);expect(s.pendingAttempts()).toHaveLength(1);
  }finally{await s.close();for(const suffix of ['','-wal','-shm'])try{unlinkSync(dbPath+suffix);}catch{}rmdirSync(dir);}
});
test('expired quote, forbidden filter and concurrent submissions',async()=>{
  let now=Date.now();const gateway=new FixtureLuckin(),s=startLuckinSystem({gateway,dbPath:':memory:',now:()=>now});try{
    await s.findShops({longitude:120,latitude:30});const id=(await s.search({shop_id:123})).entries[0]!.entry.entry_id,q=(await s.details({entry_id:id})).quote,args={quote_id:q.quote_id,expected_total_cents:q.total_cents,user_confirmed:true as const,idempotency_key:crypto.randomUUID()};now+=121000;await expect(s.createOrder(args)).rejects.toThrow('过期');expect(gateway.calls.filter(c=>c.name==='createOrder')).toHaveLength(0);
    const bad=await fetch(s.nodes[0]!.baseUrl+'/ocp/query',{method:'POST',body:JSON.stringify({query:'拿铁',filters:{provider_id:'123',brand:'ignored'}})});expect(bad.status).toBe(400);
    const fresh=(await s.details({entry_id:id})).quote,input={...args,quote_id:fresh.quote_id,idempotency_key:crypto.randomUUID()};await Promise.allSettled([s.createOrder(input),s.createOrder(input)]);expect(gateway.calls.filter(c=>c.name==='createOrder')).toHaveLength(1);
  }finally{await s.close();}
});
async function setup(gateway=new FixtureLuckin()){const s=startLuckinSystem({gateway,dbPath:':memory:'});await s.findShops({longitude:120,latitude:30});const menu=await s.search({shop_id:123,query:'拿铁'});return {s,gateway,id:menu.entries[0]!.entry.entry_id};}
test('Luckin OCP schema, dynamic SKU, coupon, explicit confirmation, idempotency and status',async()=>{
  const {s,gateway,id}=await setup();try{
    const r=await fetch(s.nodes[0]!.baseUrl+'/ocp/query',{method:'POST',body:JSON.stringify({query:'拿铁',filters:{provider_id:'123'},limit:20})});expect(catalogQueryResultSchema.safeParse(await r.json()).success).toBe(true);
    const data=await s.details({entry_id:id,quantity:2,attributes:[{group:122,value:428}]});expect(resolvableReferenceSchema.safeParse(data.resolved).success).toBe(true);expect(data.quote.total_cents).toBe(3200);expect(data.quote.productList[0]!.skuCode).toBe('SKU-ICE');expect(data.quote.selection_label).toBe('冰');
    const args={quote_id:data.quote.quote_id,expected_total_cents:3200,user_confirmed:true as const,idempotency_key:crypto.randomUUID()};
    await expect(s.createOrder({...args,user_confirmed:false})).rejects.toThrow();await expect(s.createOrder({...args,expected_total_cents:3100})).rejects.toThrow();expect(gateway.calls.filter(c=>c.name==='createOrder')).toHaveLength(0);
    const order=await s.createOrder(args);expect(order.order_id).toBe('7639308439653908490');expect(order.need_pay).toBe(true);expect(await s.createOrder(args)).toEqual(order);expect(gateway.calls.filter(c=>c.name==='createOrder')).toHaveLength(1);expect(gateway.calls.find(c=>c.name==='createOrder')!.args.couponCodeList).toEqual(['COUPON']);expect((await s.getOrder(order.order_id)).status_label).toBe('等待取餐');expect((await s.getOrder(order.order_id)).pickup_code).toBe('1234');
  }finally{await s.close();}
});
test('price changed and unknown outcome never automatically place/retry an order',async()=>{
  const {s,gateway,id}=await setup();try{
    const q=(await s.details({entry_id:id})).quote,args={quote_id:q.quote_id,expected_total_cents:q.total_cents,user_confirmed:true as const,idempotency_key:crypto.randomUUID()};gateway.price=17;
    await expect(s.createOrder(args)).rejects.toThrow('价格或优惠已变化');expect(gateway.calls.filter(c=>c.name==='createOrder')).toHaveLength(0);gateway.price=16;gateway.unknown=true;
    await expect(s.createOrder(args)).rejects.toThrow('提交结果未知');await expect(s.createOrder({...args,idempotency_key:crypto.randomUUID()})).rejects.toThrow();expect(gateway.calls.filter(c=>c.name==='createOrder')).toHaveLength(1);expect(s.pendingAttempts()).toHaveLength(1);
  }finally{await s.close();}
});
test('web is Luckin, location requires input, cross-origin order requests rejected',async()=>{
  const gateway=new FixtureLuckin(),web=startLuckinWeb(0,{gateway,dbPath:':memory:'});try{
    expect((await (await fetch(web.url)).text())).toContain('瑞幸真实门店');expect(gateway.calls).toHaveLength(0);
    const bad=await fetch(web.url+'/api/orders',{method:'POST',headers:{'content-type':'application/json',origin:'https://evil.example'},body:'{}'});expect(bad.status).toBe(403);
    const loc=await fetch(web.url+'/api/shops',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({longitude:999,latitude:30})});expect(loc.status).toBe(400);expect(gateway.calls).toHaveLength(0);
  }finally{await web.close();}
});
