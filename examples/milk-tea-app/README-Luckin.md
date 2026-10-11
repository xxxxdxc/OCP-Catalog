# 瑞幸 MCP → OCP → 网页

默认 `bun run start` 启动瑞幸真实接入版，地址为 http://127.0.0.1:5174/。这是单个 Windows 用户在本机使用的适配器。原模拟奶茶目录和四个 stdio MCP 工具保留，设置 `TEA_PROVIDER=mock` 才会启动模拟网页。

## 启动和使用

```powershell
cd '<你的 OCP-Catalog 项目目录>'
$env:Path="$env:USERPROFILE\.bun\bin;$env:Path"
bun install --frozen-lockfile
# 首次配置或令牌更换时执行；输入不含 Bearer 的令牌，不会回显
powershell.exe -NoProfile -ExecutionPolicy Bypass -File examples/milk-tea-app/Save-LuckinCredential.ps1
Remove-Item Env:TEA_PROVIDER -ErrorAction SilentlyContinue
bun run --cwd examples/milk-tea-app start
```

首次使用需要自行配置凭证。加密文件是 `data/luckin-token.dpapi`，由 Windows DPAPI 绑定当前用户和机器。服务只在后端解密，网页没有令牌输入或读取接口。凭证及订单数据库被 Git 忽略。项目移动后同一用户可继续解密，换用户或电脑必须重新配置。

1. 点击“定位附近门店”才请求浏览器定位许可，加载网页不会取定位。
2. 定位失败时展开“手动选择地点”，选择城市参考点或输入经纬度，可用门店名称缩小查询。城市参考点并非你的当前位置。浏览器 WGS84 与服务坐标体系可能有距离偏差，务必核对门店地址；目前不接第三方地址地理编码服务。
3. 明确选择自取门店，搜索咖啡、拿铁、奶茶等关键词。上游工具是推荐搜索，并非完整门店菜单接口。
4. 选择饮品，查看来自瑞幸的属性组选项。报价自动获取。修改规格或数量后报价重新计算，并清除确认。
5. 核对门店地址、规格、杯数和价格，勾选后点击“确认瑞幸真实下单”。这一步有实际交易影响。
6. 创建成功后，`needPay=true` 显示微信支付或支付二维码入口，需主动打开并自行完成支付。`false` 或缺失不会被解释为“已付款”。真实状态和取餐码通过“查询瑞幸订单状态”获取。

瑞幸公开文档没有承诺创建订单永不扣款，也没有解释所有 `needPay=false` 情形，因此网页不作此保证。本版本只做到店自取，不包含配送、取消、后台自动支付或账户全部历史订单查询。

## 分层和调用映射

```text
浏览器 public/luckin.html + luckin.js
          ↓ /api/shops/search/quote/orders
本地 Web 网关 src/luckin-web.ts
          ↓ 官方 OcpClient 实际 HTTP 调用
本地 OCP Catalog src/luckin-system.ts
          ↓ 业务映射
Streamable HTTP 客户端 src/luckin-mcp.ts
          ↓ 后端 Bearer
https://gwmcp.lkcoffee.com/order/user/mcp
```

| 环节 | OCP / 业务接口 | 瑞幸 MCP 工具 |
|---|---|---|
| 定位选店 | `/api/shops` 业务服务 | `queryShopList` |
| 能力发现 | `/.well-known/ocp-catalog`、`/ocp/manifest` | 本地能力声明 |
| 搜索商品投影 | `/ocp/query` | `searchProductForMcp` |
| 详情和下单动作 | `/ocp/resolve` | `queryProductDetailInfo` |
| 规格、报价 | `/api/quote` 业务服务 | `switchProduct`、`previewOrder` |
| 确认订单 | resolve 返回 `/shop/orders` 的需确认 API 动作 | `previewOrder` 再校验 → `createOrder` |
| 状态和取餐码 | `/api/orders/:id` | `queryOrderDetailInfo` |

query 不包含执行入口。门店用标准 `filters.provider_id` 查询；“关键词 + 门店筛选”声明 `demo.luckin.store.v1` hybrid pack，不冒充 OCP 内置语义搜索能力。报价和订单并非 OCP Catalog 标准对象，由适配器业务层管理。Catalog 的端口每次启动动态分配，终端会打印。

规格 ID 和 SKU 从瑞幸返回，不能用模拟店的杯型/甜度枚举替代。属性切换按 `operation=3` 执行，并检查最终规格没有被另一组选项隐式改掉。优惠券沿用 `previewOrder.couponCodeList`；创建前再次比较金额及优惠。报价有效期为两分钟，变价要求重新确认。订单 ID 优先读取字符串 `orderIdStr`，避免 JavaScript 大整数精度损失。

真实调用状态映射：10 待付款、20 下单成功、30 制作中、60 等待取餐、80 已完成、100 已取消。优先使用官方返回状态文字，未返回状态不能用支付金额推断。

## 防重复和验证边界

`data/luckin.sqlite` 分别保存报价和提交记录。网络调用前写入提交标记，同一报价或幂等键只会提交一次；并发请求和服务重启后重试都不能触发二次创建。超时或不可识别返回保留 unknown 记录，网页提示先在瑞幸 App 核对，不自动重试，也不把未知结果当作失败的新购买机会。这里只能避免同一报价的重复请求；用户重新生成报价并主动购买仍可能产生新订单。

仅监听 127.0.0.1，网页检查 Host 和跨站写入，内部业务下单要求随机后端 API key。调用记录不记录令牌、坐标、优惠券或支付链接。SQLite 内有本机订单和支付入口，分享项目时不要分享 `data` 文件夹。

```powershell
bun run --cwd examples/milk-tea-app typecheck
bun run --cwd examples/milk-tea-app test
```

新增测试使用 `FixtureLuckin` 假上游，覆盖真实适配逻辑、动态 SKU、金额/优惠复核、确认、幂等、未知结果、状态和跨站拒绝。浏览器脚本 `scripts/luckin-browser-check.cjs` 在独立 5175 假服务执行下单测试；`LUCKIN_QA_LIVE=1` 只查真实门店、商品和报价，绝不点击确认下单。浏览器定位许可与用户实际设备位置需要用户实际点击验证。

本次真实只读联调以杭州中心参考点查询到 8 家门店，拿铁搜索得到 3 款推荐，拿铁默认规格报价 14.11 元；价格会随账户、门店和时间变化。真实网页截图和 QA 报告在被忽略的 `evidence/luckin-real-*` 文件。没有创建真实订单、付款或取消；完整真实交易待用户自行确认执行。

官方依据：[瑞幸 MCP 工具文档](https://open01.luckincoffeecdn.com/docs)。当前字段文档也包含在官方页面加载的 [静态资源](https://open01.luckincoffeecdn.com/order-mcp-site/assets/index-LkJ8_EhP.js) 中。
