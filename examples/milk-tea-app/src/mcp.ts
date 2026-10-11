import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { startTeaSystem, searchSchema, type TeaSystem } from './system';
import { selectionSchema, orderSchema } from './store';

export function createTeaMcp(system:TeaSystem) {
  const server=new McpServer({name:'ocp-milktea-local',version:'0.1.0'},{instructions:'本地两家模拟奶茶店，无真实付款或履约。先搜索，取得明确规格的报价，向用户展示门店、饮品、杯型、甜度、冰量、加料、数量和总价；只有用户明确确认后才创建订单。预算应核对最终 total_cents；搜索价格是中杯基础价。新购买使用新报价与新幂等键，重试沿用原值。'});
  const readOnly={readOnlyHint:true,destructiveHint:false,openWorldHint:false};
  const guarded=(fn:()=>Promise<unknown>|unknown)=>Promise.resolve().then(fn).then(data=>({content:[{type:'text' as const,text:JSON.stringify(data)}]}))
    .catch(error=>({isError:true,content:[{type:'text' as const,text:JSON.stringify({error:error instanceof Error?error.message:String(error)})}]}));
  server.registerTool('search_menu',{description:'通过 OCP 查询两家模拟奶茶店；返回 entry_id、基础价、可售状态及可选规格。max_price_cny 只过滤基础价。',inputSchema:searchSchema,annotations:readOnly},args=>guarded(()=>system.search(args)));
  server.registerTool('get_drink_details',{description:'OCP resolve 后生成五分钟报价。size regular=中杯/large=大杯；sugar zero=无糖/light=三分糖/half=五分糖/full=全糖；ice regular=正常冰/less=少冰/none=去冰/hot=热。addons pearl=珍珠/coconut=椰果/cream=奶盖。显示完整报价并等待用户确认。',inputSchema:selectionSchema,annotations:{...readOnly,readOnlyHint:false}},args=>guarded(()=>system.details(args)));
  server.registerTool('create_order',{description:'仅在用户明确确认报价后创建模拟自取订单。quote_id、expected_total_cents 从报价获取，user_confirmed=true；幂等键重试保持不变。不会付款或向真实门店下单。',inputSchema:orderSchema,annotations:{...readOnly,readOnlyHint:false,idempotentHint:true}},args=>guarded(()=>system.createOrder(args)));
  server.registerTool('get_order_status',{description:'查询已持久化的本地模拟订单；30 秒后模拟可取餐，没有真实履约。',inputSchema:z.object({order_id:z.string().min(1)}).strict(),annotations:readOnly},args=>guarded(()=>system.getOrder(args.order_id)));
  return server;
}
if(import.meta.main){const system=startTeaSystem();const handle=serveStdio(()=>{const server=createTeaMcp(system);server.server.onclose=()=>{void system.close();};return server;});
  console.error('茶选 MCP ready: local simulation, 2 independent OCP catalogs');
  const close=async()=>{await handle.close();process.exit(0);};process.on('SIGINT',close);process.on('SIGTERM',close);}
