import { startTeaSystem } from './system';
import { OcpClient } from '@ocp-catalog/ocp-client';
import { resolve } from 'node:path';
import { catalogManifestSchema,catalogHealthResponseSchema } from '@ocp-catalog/ocp-schema';

const system=startTeaSystem({dbPath:':memory:'}),node=system.nodes[0],client=new OcpClient();
function show(step:string,data:unknown){console.log(`\n${step}\n${JSON.stringify(data,null,2)}`);}
try{
  show('01 · 发现两个独立 OCP 目录',system.nodes.map(n=>({shop:n.shopId,url:n.baseUrl})));
  show('02 · well-known 发现入口',await(await fetch(`${node.baseUrl}/.well-known/ocp-catalog`)).json());
  const manifest=await client.inspectCatalog(`${node.baseUrl}/ocp/manifest`);show('03 · 官方 Schema 校验 manifest',catalogManifestSchema.parse(manifest).catalog_name);
  show('04 · health 校验',catalogHealthResponseSchema.parse(await(await fetch(`${node.baseUrl}/ocp/health`)).json()));
  const cli=Bun.spawn([process.execPath,resolve(import.meta.dir,'../../../packages/ocp-cli/src/index.ts'),'catalog','inspect',`${node.baseUrl}/ocp/manifest`],{stdout:'pipe',stderr:'pipe'});
  const out=await new Response(cli.stdout).text();if(await cli.exited!==0)throw new Error('官方 CLI 校验失败');show('05 · 未修改的仓库 CLI 读取目录',JSON.parse(out));
  show('06 · 跨店查询珍珠奶茶',await system.search({query:'珍珠',max_price_cny:25}));
  show('07 · 果茶 + 20 元以内结构化筛选',await system.search({category:'果茶',max_price_cny:20,in_stock_only:true}));
  show('08 · resolve view：详情链接',await client.resolveCatalogEntry(`${node.baseUrl}/ocp/resolve`,{entry_id:'qingyu:pearl',purpose:'view',live_check:true,requested_fields:[]}));
  const details=await system.details({entry_id:'qingyu:pearl',size:'large',sugar:'light',ice:'less',addons:['pearl'],quantity:1});show('09 · resolve checkout + 五分钟规格报价',details);
  const order=await system.createOrder({quote_id:details.quote.quote_id,expected_total_cents:details.quote.total_cents,user_confirmed:true,idempotency_key:crypto.randomUUID()}) as {order_id:string};show('10 · 独立业务接口模拟下单与状态',system.getOrder(order.order_id));
  console.log('\n全流程通过。仅创建内存模拟订单；服务已准备关闭。');
}finally{await system.close();}
