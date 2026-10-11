# 茶选：基于 OCP 的奶茶应用

新增 **[团餐管家 Codex skill](./README-TeamMeal.md)**：组织者提供微信聊天文字，整理团队偏好，接入瑞幸和麦当劳，同店整单报价、预算核对、局部重配和付款人确认后提交。源码位于仓库 `skills/team-meal-manager`。

**当前默认网页已接入瑞幸真实 MCP，启动和使用请先阅读 [瑞幸接入说明](./README-Luckin.md)。** 下方保留原模拟奶茶应用的说明；如需运行它，启动前设置 `$env:TEA_PROVIDER='mock'`。`bun run mcp` 和原有 `ocp-milktea-local` 仍是模拟工具，不会创建真实瑞幸订单。

两家独立模拟门店、八款饮品、网页点单、四个 MCP 工具和 SQLite 订单。没有真实支付、商家订单或履约。

## 一分钟启动

PowerShell 从仓库根目录执行：

```powershell
# 如果当前终端还找不到 Bun
$env:Path = "$env:USERPROFILE\.bun\bin;$env:Path"
bun install --frozen-lockfile
bun run --cwd examples/milk-tea-app start
```

打开终端打印的地址，默认 `http://127.0.0.1:5174`。应用在同一进程中启动两个独立 HTTP Catalog，自动分配空闲端口。按 Ctrl+C 关闭本次服务。若 5174 被占用，可设置 `$env:TEA_WEB_PORT='5175'` 再启动。

当前仓库位于 `<你的 OCP-Catalog 项目目录>`。移动项目后按新的路径进入目录，并重新核对 MCP 配置中的绝对启动路径。

## 网页演示

1. 菜单展示青屿茶坊和暮山茶社的独立商品，支持门店、类别和中杯基础价筛选。
2. 选择「经典珍珠奶茶 · 青屿茶坊」。价格自动出现，无需额外点报价按钮。
3. 选大杯、三分糖、少冰、加珍珠、1 杯；服务器返回 16+2+2 = **20 元**。
4. 调整任一规格或数量会自动刷新报价，清除旧确认。确认前不能下单。
5. 勾选确认，创建模拟订单。SQLite 保存订单号和模拟取餐码。
6. 在「我的订单」查询。10 秒后模拟制作中，30 秒后模拟可取餐。
7. 打开「协议演示」查看真实 manifest、query、resolve、业务订单调用的门店与地址。

搜索价格是中杯基础价；大杯、加料和多杯总价可能超过筛选预算，确认区域会提示。报价五分钟有效，网页会自动刷新过期报价。浏览器在请求切换时取消旧请求，旧结果不能覆盖新规格。

## 对照 PDF 的复现与验证

用户提供的《用 OCP 做一个奶茶铺：从零复现指引》是设计和演示参考，没有附带它所述 `work/ocp-milktea-demo` 的源代码。本应用独立实现并对照以下关键点：

- Catalog 提供 well-known、manifest、health、contracts、query、resolve 六个端点。
- query 返回 CatalogEntry 投影，不提供下单动作或内部密钥。
- resolve `purpose=view` 返回可访问的详情页面；`purpose=checkout` 返回 API 动作、确认要求和有效期。
- 下单在 `/shop/orders` 完成，属于独立业务接口。
- 使用当前仓库未修改的官方 CLI 和官方 Schema 实际验证。
- 不存在的商品 404；offset 非零、未知 query pack、未声明模式和不支持的游标 400。

运行：

```powershell
bun run --cwd examples/milk-tea-app typecheck
bun run --cwd examples/milk-tea-app selfcheck
bun run --cwd examples/milk-tea-app demo
```

`selfcheck` 运行协议、业务、网页 API 和真实 stdio MCP 测试，包括 CLI 子进程读取两个 manifest。`demo` 自动启动两个目录，用内存数据库完成十步协议走查，打印 view/checkout 对比和订单，再关闭服务；不占固定端口，不写入网页订单数据。

当前官方 Schema 没有单独导出 well-known 或 contracts 列表校验器：测试对 discovery 地址做结构核验，使用官方 `objectContractSchema` 校验契约列表成员。manifest、health、query、resolve 直接使用官方响应 Schema。通过这些检查是格式与行为证据，不是第三方认证。

关键词查询支持中文名称及少量明确词组规则（例如「不太甜的果茶」识别为果茶）；这是确定性匹配，不是语义模型。甜度在规格报价中选择。自定义 filter pack 使用已有的 category/max_amount/in_stock_only 字段，没有扩展标准 filters。

## MCP 接入

```powershell
& .\examples\milk-tea-app\Register-CodexMcp.ps1
codex mcp get ocp-milktea-local
```

脚本注册用户级 stdio MCP，使用绝对 Bun 和服务文件路径；同名不同配置会停止而不会覆盖。Codex 启动 MCP 后，该进程自行启动两个目录，无需另开网页终端。MCP 与网页默认共享 SQLite，所以工具创建的订单在刷新网页后可见。当前聊天工具集可能需要重启 Codex 才能加载；配置成功和聊天实际加载工具是两种验证。

| 工具 | 用途 |
|---|---|
| `search_menu` | 跨店 OCP 搜索，可按 shop_id/category/max_price_cny/in_stock_only 筛选 |
| `get_drink_details` | 按 entry_id 和规格 resolve，生成五分钟报价 |
| `create_order` | 提交 quote_id、expected_total_cents、user_confirmed:true、idempotency_key |
| `get_order_status` | 查询 order_id 的持久化状态 |

规格：size `regular/large`；sugar `zero/light/half/full`；ice `regular/less/none/hot`；addons `pearl/coconut/cream`。各商品限制以搜索结果的 options 为准。数量 1–5。

对 Codex 说：

> 用 ocp-milktea-local 查珍珠奶茶。我要大杯、三分糖、少冰、加珍珠、1 杯，预算 25 元。先展示门店、规格和总价，暂时不要下单。

确认报价后再说：

> 确认这份模拟订单，请创建并查询状态。

MCP 的 user_confirmed 字段是调用方对用户确认的声明，服务端不能独立证明自然语言对话中发生了确认。真实支付应增加宿主确认 UI、用户身份和商家授权。

## 架构和数据

```text
网页 -> 本地应用 API ─┐
Codex -> stdio MCP ──┴-> OcpClient -> 两个独立 Catalog
                                  -> resolve 动作 -> 门店订单 API -> SQLite
```

- `src/data.ts`：两家店、菜单和规格词典。
- `src/catalog.ts`：每家店独立的 OCP 面与下单动作。
- `src/system.ts`：OCP 跨店搜索、可信动作调用及轨迹。
- `src/store.ts`：整数分计算、报价、事务库存扣减、幂等及持久化。
- `src/server.ts`：网页和应用 API。
- `src/mcp.ts`：四个工具及连接生命周期。
- `public/`：无构建依赖的网页；杯子插图是本地 SVG，无外部图片服务。
- `src/tea.test.ts`：协议和业务回归测试。
- `scripts/browser-check.cjs`：真实浏览器交互测试；Playwright 仅用于 QA，须由测试环境提供。

默认数据库为 `data/tea.sqlite`（Git 忽略）。`TEA_DB_PATH` 可改为绝对路径。首次初始化导入模拟库存，重启不会重置库存。一份报价只创建一张订单，重试不重复扣库存；新购买使用新报价和新幂等键。查询状态按时间推导，是模拟展示。网页为单用户本地演示，订单列表共享；不适合直接公网部署。

所有服务只监听 127.0.0.1。独立商家下单接口要求进程内部临时 x-api-key；网页拒绝外部 Origin 的写请求。没有实现 Registration、Provider 注册同步、真实商家接口、真实付款或取消退款。

## 浏览器演示证据

`evidence/` 中保存桌面菜单、自动报价、订单、订单历史、协议轨迹、手机页面截图和 `browser-report.json`，目录不加入版本控制。浏览器测试使用独立临时 Chrome 配置，不会修改日常浏览器资料。

阅读顺序推荐：`data.ts -> store.ts -> catalog.ts -> system.ts -> mcp.ts/server.ts`。先理解商品和订单，再看 OCP 如何返回动作，最后看网页和 Agent 如何共用它。
