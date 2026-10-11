import { test,expect } from 'bun:test';
import { mkdtempSync,rmSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { catalogManifestSchema,catalogHealthResponseSchema,catalogQueryResultSchema,resolvableReferenceSchema,objectContractSchema } from '@ocp-catalog/ocp-schema';
import { z } from 'zod';
import { TeaStore } from './store';
import { startTeaSystem } from './system';
import { startTeaWeb } from './server';
import { connectTea } from './client';

const selected={entry_id:'qingyu:pearl',size:'large',sugar:'light',ice:'less',addons:['pearl'],quantity:1};
function tempDb(){const dir=mkdtempSync(join(tmpdir(),'tea-test-')),path=join(dir,'tea.sqlite');return{path,cleanup:()=>{for(const suffix of ['','-wal','-shm'])rmSync(path+suffix,{force:true});rmdirSync(dir);}};}
async function post(url:string,body:unknown){return fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});}
async function rejects(fn:()=>Promise<unknown>,text:string){let message='';try{await fn();}catch(e){message=e instanceof Error?e.message:String(e);}expect(message).toContain(text);}

test('precise option pricing, invalid options, confirmation and quote expiration',()=>{
  let now=1800000000000;const store=new TeaStore(':memory:',()=>now);
  try{
    const q=store.quote(selected);expect(q.total_cents).toBe(2000);expect(q.selection_label).toContain('三分糖');
    const input={quote_id:q.quote_id,expected_total_cents:2000,user_confirmed:true,idempotency_key:'confirmed-1'};
    expect(()=>store.createOrder({...input,user_confirmed:false})).toThrow();
    expect(()=>store.createOrder({...input,expected_total_cents:1})).toThrow('金额');
    expect(()=>store.quote({...selected,entry_id:'qingyu:mango',ice:'hot'})).toThrow('热饮');
    expect(()=>store.quote({...selected,addons:['pearl','pearl']})).toThrow('加料');
    expect(()=>store.quote({...selected,entry_id:'mushan:grape'})).toThrow('售罄');
    now+=300001;expect(()=>store.createOrder(input)).toThrow('过期');
  }finally{store.close();}
});
test('transactional stock recheck and duplicate orders never double-decrement',()=>{
  const store=new TeaStore(':memory:');try{
    store.db.query('UPDATE tea_stock SET quantity=1 WHERE entry_id=?').run(selected.entry_id);
    const q1=store.quote(selected),q2=store.quote(selected);
    const args={quote_id:q1.quote_id,expected_total_cents:q1.total_cents,user_confirmed:true,idempotency_key:'stock-test-key'};
    const order=store.createOrder(args);expect(store.stock(selected.entry_id)).toBe(0);
    expect(store.createOrder(args).order_id).toBe(order.order_id);expect(store.stock(selected.entry_id)).toBe(0);
    expect(()=>store.createOrder({...args,quote_id:q2.quote_id,idempotency_key:'second-purchase'})).toThrow('库存');
    expect(store.listOrders()).toHaveLength(1);
  }finally{store.close();}
});
test('SQLite persistence across restart and simulated fulfillment time',()=>{
  const db=tempDb();let now=1800000000000;let store=new TeaStore(db.path,()=>now);
  try{const q=store.quote(selected),o=store.createOrder({quote_id:q.quote_id,expected_total_cents:q.total_cents,user_confirmed:true,idempotency_key:'persistent-tea'});
    store.close();store=new TeaStore(db.path,()=>now);now+=30000;expect(store.getOrder(o.order_id).status).toBe('ready');expect(store.stock(selected.entry_id)).toBe(19);
  }finally{store.close();db.cleanup();}
});
test('two independent Catalogs: six endpoints, official schemas, view versus checkout and boundary errors',async()=>{
  const system=startTeaSystem({dbPath:':memory:'});try{
    for(const node of system.nodes){
      const discovery=await(await fetch(`${node.baseUrl}/.well-known/ocp-catalog`)).json() as {manifest_url:string};
      expect(discovery.manifest_url).toBe(`${node.baseUrl}/ocp/manifest`);
      catalogManifestSchema.parse(await(await fetch(discovery.manifest_url)).json());
      catalogHealthResponseSchema.parse(await(await fetch(`${node.baseUrl}/ocp/health`)).json());
      z.object({kind:z.literal('ObjectContractList'),object_contracts:z.array(objectContractSchema)}).parse(await(await fetch(`${node.baseUrl}/ocp/contracts`)).json());
      const result=catalogQueryResultSchema.parse(await(await post(`${node.baseUrl}/ocp/query`,{query:'珍珠',query_pack:'ocp.query.keyword.v1'})).json());
      expect(result.result_count).toBe(1);expect(result.entries[0].entry.provider_id).toBe(node.shopId);
      expect(JSON.stringify(result)).not.toContain('action_bindings');expect(JSON.stringify(result)).not.toContain('apiKey');
      const entry=result.entries[0].entry.entry_id;
      for(const purpose of ['view','checkout']){
        const value=resolvableReferenceSchema.parse(await(await post(`${node.baseUrl}/ocp/resolve`,{entry_id:entry,purpose})).json());
        expect(value.action_bindings[0].action_type).toBe(purpose==='view'?'url':'api');
        expect(value.action_bindings[0].requires_user_confirmation).toBe(purpose==='checkout');
        if(purpose==='checkout')expect(value.action_bindings[0].expires_at).toBeDefined();
        else expect((await fetch(value.action_bindings[0].entrypoint.url)).status).toBe(200);
      }
      expect((await post(`${node.baseUrl}/ocp/resolve`,{entry_id:'missing'})).status).toBe(404);
      expect((await post(`${node.baseUrl}/ocp/query`,{offset:1})).status).toBe(400);
      expect((await post(`${node.baseUrl}/ocp/query`,{query_pack:'undeclared.pack'})).status).toBe(400);
      expect((await post(`${node.baseUrl}/ocp/query`,{query_mode:'semantic',query:'茶'})).status).toBe(400);
      expect((await post(`${node.baseUrl}/shop/orders`,{})).status).toBe(401);
      const cli=Bun.spawn([process.execPath,resolve(import.meta.dir,'../../../packages/ocp-cli/src/index.ts'),'catalog','inspect',`${node.baseUrl}/ocp/manifest`],{stdout:'pipe',stderr:'pipe'});
      const out=await new Response(cli.stdout).text();expect(await cli.exited).toBe(0);expect(out).toContain(`tea_${node.shopId}`);
    }
    const results=await system.search({query:'珍珠'});expect(results.entries).toHaveLength(2);
    const filtered=await system.search({category:'果茶',max_price_cny:20,in_stock_only:true});expect(filtered.entries).toHaveLength(2);
    const q=await system.details(selected);const args={quote_id:q.quote.quote_id,expected_total_cents:q.quote.total_cents,user_confirmed:true,idempotency_key:'system-order-key'};
    const order=await system.createOrder(args) as {order_id:string};expect((await system.createOrder(args) as {order_id:string}).order_id).toBe(order.order_id);
  }finally{await system.close();}
},20000);
test('web gateway serves page and rejects cross-origin or unconfirmed orders',async()=>{
  const web=startTeaWeb(0,':memory:');try{
    expect((await fetch(web.url)).status).toBe(200);
    expect((await(await fetch(`${web.url}/app.js`)).text()).includes('createOrder')).toBe(true);
    const denied=await fetch(`${web.url}/api/orders`,{method:'POST',headers:{'content-type':'application/json',origin:'https://other.example'},body:'{}'});expect(denied.status).toBe(403);
    const data=await(await post(`${web.url}/api/quote`,selected)).json() as {quote:{quote_id:string;total_cents:number}};
    expect((await post(`${web.url}/api/orders`,{quote_id:data.quote.quote_id,expected_total_cents:data.quote.total_cents,user_confirmed:false,idempotency_key:'web-test-id'})).status).toBe(400);
  }finally{await web.close();}
});
test('stdio MCP four tools, cross-shop search, confirmed order and restart query',async()=>{
  const db=tempDb();let connection=await connectTea(db.path);try{
    expect((await connection.client.listTools()).tools.map(t=>t.name).sort()).toEqual(['create_order','get_drink_details','get_order_status','search_menu']);
    expect((await connection.call('search_menu',{query:'珍珠'})).entries).toHaveLength(2);
    const details=await connection.call('get_drink_details',selected);
    const args={quote_id:details.quote.quote_id,expected_total_cents:details.quote.total_cents,user_confirmed:true,idempotency_key:'mcp-tea-test-key'};
    await rejects(()=>connection.call('create_order',{...args,user_confirmed:false}),'Input');
    const order=await connection.call('create_order',args);expect(order.simulation).toBe(true);
    expect((await connection.call('create_order',args)).order_id).toBe(order.order_id);
    await connection.close();connection=await connectTea(db.path);
    expect((await connection.call('get_order_status',{order_id:order.order_id})).order_id).toBe(order.order_id);
    await rejects(()=>connection.call('get_drink_details',{...selected,entry_id:'mushan:grape'}),'售罄');
  }finally{await connection.close();db.cleanup();}
},30000);
