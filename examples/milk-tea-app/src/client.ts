import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { resolve } from 'node:path';
export async function connectTea(dbPath?:string){
  const client=new Client({name:'tea-demo-verifier',version:'0.1.0'});
  const transport=new StdioClientTransport({command:process.execPath,args:[resolve(import.meta.dir,'mcp.ts')],
    ...(dbPath?{env:{...Object.fromEntries(Object.entries(process.env).filter((e):e is [string,string]=>e[1]!==undefined)),TEA_DB_PATH:dbPath}}:{})});
  try{await client.connect(transport,{timeout:10000});}catch(error){await transport.close();throw error;}
  return {client,call:async(name:string,args:Record<string,unknown>)=>{const r=await client.callTool({name,arguments:args},{timeout:5000});const text=r.content.find(c=>c.type==='text');
    if(!text||text.type!=='text')throw new Error('MCP 返回内容无效');if(r.isError)throw new Error(text.text);return JSON.parse(text.text);},close:()=>client.close()};
}
