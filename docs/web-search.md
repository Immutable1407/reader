# 阅读聊天中的联网搜索

在聊天输入框旁点击「联网搜索：关」切换为「联网搜索：开」，可授权当前问题使用联网搜索。默认关闭；切换文档或会话后恢复关闭。重新生成保留原问题的联网权限，后端不接受通过重新生成偷偷修改这一权限。

## 支持范围

- **Codex**：使用 App Server 原生 `web_search="live"`，支持搜索、打开网页及页内查找。保留只读沙箱，关闭 Shell、Apps、插件等其他能力，逐项禁用继承的 MCP，仅注册当前文档工具。会话缓存包含联网模式；恢复会话时重新应用并核验配置。图片问答、翻译等生成路径也采用相同的 MCP 隔离入口；翻译不启用联网。
- **API / 内置 Pi**：首版仅支持配置了 Key 的 DeepSeek 官方 OpenAI 兼容连接（根地址、`/v1` 或 `/beta`）。复用当前连接的 Key，调用官方 `POST https://api.deepseek.com/v1/tools/search` 和 `/v1/tools/fetch`。模型须通过现有的工具调用检测。其他服务或代理地址不自动转发 Key 到 DeepSeek。
- **Claude / Kimi**：本轮不增加联网工具，界面禁用联网开关。既有适配器权限核查中发现的问题不因本功能而视为已修复。

开启联网的请求失败时不自动切换到另一个后端，避免用户收到未执行联网却被当作搜索结果的回答。

DeepSeek 参考：[Search & Fetch 指南](https://api-docs.deepseek.com/zh-cn/guides/search/)、[Search](https://api-docs.deepseek.com/zh-cn/api/search/)、[Fetch](https://api-docs.deepseek.com/zh-cn/api/fetch/)。这两项是独立工具 API，未向 Chat Completions 请求添加未经支持的 `enable_search` 参数。

## 执行记录与来源

聊天回答上方提供可展开的执行记录。搜索词、网页 URL、工具名和中途进度来自实际工具事件；按调用 ID 更新为执行中、完成、失败或取消，正文到达后仍可展开查看。Go 文档工具补充实际读取的章节、页码或关键词。

Codex 的 `item/started`、`item/completed` 和 `item/mcpToolCall/progress` 经 stdio JSON-RPC 接收，由 Go 转为统一的 `tool` SSE 事件；Pi 的工具桥接调用使用同一事件结构。MCP 只显示已知安全参数和服务/工具身份，不展示完整请求、认证头或原始工具结果。

成功回答将执行记录和网页来源一起保存到消息。搜索摘要与读取到的正文分别标记，记录获取时间，超过 8192 UTF-8 字节的正文快照明确标为截短。DeepSeek 每次搜索最多返回 5 个候选，本轮网页调用最多 12 次；最多保存 24 个网页来源、256 个执行步骤。失败或取消的独立会话保留运行事件，重新打开未完成的问题时可恢复查看。

文档引用仍按已读证据校验 `[S1]`。外部来源使用 Markdown 链接。能从 Codex 返回结果确定 URL 的原生网页引用会转换为链接；缺少 ID/URL 对应关系时显示“网页引用未解析，见执行记录”，不根据结果顺序猜测来源，也不绕过文档 S 引用校验。

不同 App Server 版本可能只返回查询或动作而不返回结果 URL、标题或正文。此时仅展示实际返回的信息；“打开网页”事件不等于 Reader 取得了网页正文快照。第三方 MCP 的内部多个 HTTP 请求也只有在工具上报进度时才可见。

## 请求边界

联网授权来自 HTTP 请求的 `webSearch` 布尔值并保存在用户问题中，不接受文档内容或模型输出修改权限。关闭时不注册 API 网页工具，并将 Codex 搜索设为 disabled；历史网页资料只作为历史快照。

DeepSeek 只收到必要查询词或指定 URL，不发送整篇文档及聊天历史。Fetch 请求在本机检查协议、凭据、localhost、内网和链路本地 IP，包括 DNS 解析结果；实际网页抓取由 DeepSeek 执行，远端抓取和跳转策略仍由其安全策略负责。Search/Fetch API 目标固定为 DeepSeek 官方 origin，不跟随 API HTTP 重定向。错误展示不包含原始上游响应体。

Codex 原生搜索请求由 App Server/服务端执行，Reader 收到的是执行通知，无法在每次请求前审核或改写其底层 HTTP 请求。当前授权和只读配置不等于完整进程级网络/文件系统隔离。

## 验证与人工检查

自动化覆盖 IPC 工具生命周期、继承 MCP 的禁用、DeepSeek 请求协议、权限关闭、来源快照保存、截短、预算、内网 URL、重定向、取消和限流；Pi worker 使用本地模型响应替身，不访问商业模型服务。

可选原生 CLI 配置预检：在 `apps/server` 运行 `READER_TEST_CODEX_WEB_PREFLIGHT=1 go test ./internal/reader -run '^TestCodexWebPreflightNative$' -count=1`。只初始化实际安装的 CLI 并核验配置，不启动模型回合或调用 MCP。

开发预览：启动 Web 开发服务，打开 `/__web-search`。这是合成示例；可切换明暗、执行状态并调整面板宽度，检查展开/收起、链接、长文本换行和减少动态效果。项目不使用浏览器自动化进行视觉验收。

实际使用时，分别用 Codex 和 DeepSeek 官方 API 开启联网，搜索一个公开主题、读取链接，再关闭联网发送问题。检查查询/网页步骤、成功与失败、取消、重新打开聊天、引用原文与网页的区别。真实服务可用性和原生桌面视觉效果需单独验收；受控测试不代表两者已经完成。

## 真实服务回归

2026-10-23 在 `5115bfa` 上用真实 Codex `0.163.0-alpha.11.1` 和 DeepSeek 官方 `deepseek-flash` 完成了搜索、读取公开文档、保存与重新打开，以及执行中取消测试。两边的取消回合均保存为 cancelled，没有助手答案或 done 事件。真实 SSE 数据另外经过 `ChatSession` 和 `ToolActivities` DOM 回放，验证步骤更新、取消标签、来源链接和保存后的状态核对；这不替代原生桌面的像素与交互人工验收。

本次单轮观察（不是性能基准）：

| 后端     | 搜索与读取回合                               | 保存步骤/来源                                    | 执行中取消                     |
| -------- | -------------------------------------------- | ------------------------------------------------ | ------------------------------ |
| Codex    | 约 32.1 秒，返回两个正确 endpoint 和网页链接 | 2 步 / 12 个搜索来源；原生协议未提供完整正文快照 | cancelled，无助手答案、无 done |
| DeepSeek | 约 5.3 秒，返回两个正确 endpoint 和网页链接  | 2 步 / 4 个来源，包含读取的正文快照              | cancelled，无助手答案、无 done |

按需运行下面的测试会调用真实模型与搜索服务。只使用合成文档及公开查询，聊天与运行状态只写入测试临时书库，另将脱敏报告写入显式指定的路径；不修改提供连接配置的原书库，也不读取 Codex/Claude 凭据文件。测试默认跳过：

```sh
cd apps/server
READER_TEST_WEB_PROVIDERS=codex,api \
READER_TEST_DOCUMENT_API_CONFIG="<已有 Reader DeepSeek 连接配置文件>" \
READER_TEST_WEB_REPORT="<书库以外的报告 JSON 路径>" \
go test ./internal/reader -run '^TestLiveWebSearchLifecycle$' -count=1 -v -timeout=15m
```

随后在仓库根目录使用同一个 `READER_TEST_WEB_REPORT` 运行 `pnpm exec vitest run apps/web/src/chat/web-search-live.test.tsx`。报告排除模型思考内容和认证数据，网页文本仅保留前 400 字节供检查，并通过 `reportTextLimitBytes` 标明报告自身的摘录限制；产品中原始保存的快照不受报告摘录影响。
