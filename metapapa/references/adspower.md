# AdsPower 连接与操作

仅用于用户选择 AdsPower 时。普通 Chrome 继续使用 [browser-workflow.md](browser-workflow.md)。不连接其他浏览器的任意调试端口。首版使用 AdsPower Local API V1 和 Chromium 内核；Firefox 环境未适配。

## 准备与认证

- AdsPower 已启动，账号具有 Local API 权限；在“自动化 → API”确认服务状态和实际端口。默认 `http://127.0.0.1:50325`，官方 local.adspower.com/net 别名会规范化为本机 loopback。
- AdsPower 路线要求 Node 22.12+。在 Skill 目录首次执行 `npm ci --ignore-scripts --no-audit --no-fund`，按锁文件安装 `puppeteer-core`；普通 Chrome 和匿名 FBID 不需要这项依赖。
- API Key 通过当前任务内存、环境变量 `METAPAPA_ADSPOWER_API_KEY` 或 runner 第一行标准输入提供。已有用户授权和 Key 时直接使用，不重复索要。不得把 Key 写入命令行参数、任务 JSON 文件、Skill、代码、分发包或日志；也不要打印完整 API 响应。
- `ADSPOWER_AUTH_REQUIRED` 或 API 返回 authentication 错误才需要用户检查 Key。沙箱的 EPERM/网络权限错误不等于 Key 失效：按工具的权限流程请求已授权的本机访问，不更换账号或关闭安全验证。

## Onboarding

1. 用户指定了环境 ID 就只查询该环境；未指定时分页列出名称、编号、分组供选择。环境列表默认丢弃用户名、密码、代理凭证等字段。
2. 查询 `/api/v1/browser/active`。已运行则直接复用；用户授权使用该环境且尚未启动时，以可见窗口启动，保留历史标签页与缓存。启动超时只检查一次状态，不自动重放启动。
3. 在该环境读取现有 Facebook 页面；有草稿时新开页面。引导用户在此窗口完成个人账号登录，密码/验证码在官网输入，详见 [onboarding](onboarding.md)。
4. `login_state` 若显示 challenge_required，则停止业务查询并引导用户处理官网解锁；不要绕过或继续调用接口。核对当前可见个人身份后，再用 `inspectSession()` 取得本次 actor_id。环境 ID、环境名称、Facebook 个人 ID 是不同值，不相互推断。
5. 所有业务页使用同一个环境、同一个 expectedActorId。计划和日志记录 browser_context；同一 Facebook 个号位于另一 AdsPower 环境，也不能复用原日志执行或恢复。
6. 任务结束 `disconnect()`，默认保留窗口。关闭环境是另外的动作；用户明确要求时才调用 stop。切换环境先断开旧连接，再重新核对身份，不把旧 client、计划或句柄带入新环境。

## 任务内 JSON-lines runner

入口：`node <skill-dir>/scripts/adspower-runner.mjs`。它在当前任务进程中保存连接和计划，逐行接收 JSON，逐行返回脱敏 JSON；没有服务端口、后台服务或自建 MCP。

使用可持续写 stdin 的执行会话。如果必须使用 PTY，先关闭终端输入回显（POSIX 可用 `stty -echo`），再启动 runner；不要把包含 Key 的输入复制到文件。传完每行后等待其响应，再执行依赖结果的命令。标准输入关闭或收到 SIGINT/SIGTERM 时断开控制连接，保留浏览器。

第一行结构（以下均为占位值，Key 必须来自当前授权的内存输入）：

```json
{"command":"connect","profileId":"PROFILE_ID","apiKey":"RUNTIME_SECRET","allowStart":true,"mode":"read_only"}
```

若已通过环境变量提供 Key，省略 apiKey。响应仅包含环境的安全元数据、标签页和模式，不包含调试 WebSocket 地址或 Key。

```json
{"command":"open","url":"https://www.facebook.com/"}
{"command":"session","tabId":"tab-2"}
{"command":"snapshot","tabId":"tab-2"}
```

`tab-2` 只是示例；必须从本次返回结果选取。只有在用户指定的环境内，才能继续打开 Ads Manager/Business/Commerce 页面。

| command | 用途与参数 |
|---|---|
| connect / disconnect | 连接指定环境 / 断开控制；默认 read_only |
| tabs / open / navigate | 列标签页、为 Meta URL 新开页、导航指定 tabId；不覆盖草稿 |
| login_state / session | 检测登录/锁定状态 / 核对 tabId 当前身份；首个已核实 actor 绑定本次任务 |
| snapshot / screenshot | 读取可见文本和控件标签 / 保存指定绝对 path 的截图；不会输出原始 HTML 或输入框值 |
| read | tabId、operation、params；可设 paginate:true 和 options。仅执行注册读操作 |
| fbid | tabId、url；在该环境页面使用已登录的 FBID GET 回退 |
| catalog_open | tabId、catalogId、businessId，可带 journalPath/manifestPath/resume；返回 handle |
| catalog_call | handle、method、args 数组；只读模式允许 inspectSession、listFeeds、feedDetails、checkResult |
| product_plan / product_restore_plan | field 为 url/image/name；tabId、readTabId 和 params 或 journalPath；仅 catalog_write 模式 |
| product_execute | planId、authorizedPlanId、独立 journalPath；计划必须来自本进程、精确核对并获得本次用户授权 |
| product_reconcile | field、tabId、readTabId、journalPath；只读对账，不重发 |
| ui_link | tabId、selector；仅导航唯一真实链接，拒绝 action/API 地址 |
| ui_catalog_create_click / ui_catalog_create_fill | catalog_write 模式；tabId、businessId、唯一 selector，填充时带 value。仅指定 BM 的 Commerce 资产页与 `/products/catalogs/new/`，且当前 actor 必须匹配 |
| ui_click / ui_fill / ui_upload | 仅 catalog_write 模式，要求 tabId、当前 catalogId、唯一 selector；分别提供 value/path。禁止广告管理页及不匹配的目录 |

读操作示例：

```json
{"command":"read","tabId":"tab-3","operation":"accounts.list","paginate":true,"options":{"maxPages":20}}
```

需要保存业务结果时可以给命令加 `outputPath`（绝对任务路径）；不要给 connect 保存 Key 输入。原始凭证和调试端点不会包含在结果中。分页必须检查 complete；不能把首屏说成全部。

## 写入限制

本 Skill 默认 `no_ad_account_writes`：禁止广告账户修改、广告启停、BM 广告账户创建/关联/移除、Pixel/Dataset 账户关联，以及无法证明不涉及广告账户的通用资产权限修改。共 19 个已有命名写操作被拦截；检查发生在 plan/execute 阶段、发出业务请求之前。Chrome 和 AdsPower 均遵守这一限制；也不得绕到 UI、原始 CDP 或其他接口执行。

AdsPower runner 更严格，默认 read_only，且没有通用 mutation/evaluate 命令。只有用户明确指定 Catalog 写入任务时，新的连接才能选择 `catalog_write`；这只开放专用 Catalog 方法及当前目录的 UI 编辑，不开放广告写入。模式不等于业务授权，仍需核对具体商品/文件/字段、计划、日志、回读与截图。

核心客户端保留 `standard` 兼容参数供独立维护测试；当前用户禁止广告账户写入期间不可使用它绕过限制，也不能因为换了浏览器而解除限制。广告写入测试只用模拟数据，禁止生产实测。

AdsPower 页面操作助手只封装 Meta 页面导航、读取、截图和 Catalog 编辑入口；这不是任意网站自动化工具。页面跳到挑战/登录页时交给用户；不要把错误当成授权执行其他动作。

## 模块调用

在获准访问本机 API 的 Node 环境，可以直接导入模块，无需 runner：

```js
const {createAdsPowerApi} = await import('file://' + SKILL_DIR + '/scripts/adspower.mjs');
const api = createAdsPowerApi({baseUrl,apiKey:sessionSecret});
const connection = await api.attach(profileId,{allowStart:true});
const tab = await connection.newPage('https://www.facebook.com/');
const {createMetaClient} = await import('file://' + SKILL_DIR + '/scripts/client.mjs');
const client = createMetaClient({cdp:tab.cdp,writePolicy:'read_only'});
const session = await client.inspectSession();
// 在当前个人身份核对后，将 session.actor_id 传给其他页面客户端。
// finally 中释放：await connection.disconnect(); api.dispose();
```

`tab.cdp.send('Runtime.evaluate', params, {timeoutMs})` 保持现有客户端契约。实例超时后标记结果未知，拒绝继续使用该 page 句柄；重新连接、只读核对后才能决定下一步。底层调试会话错误不会原样输出，避免错误中包含表达式或会话材料。

## 实测与接口依据

AdsPower 的实际通过项与限制见 `verification.json` / [coverage](coverage.md)。Chrome 已有验收结果不自动算作 AdsPower 验收；账号、地区、内核或页面协议变化可能影响现有接口。

使用的 Local API：GET /status、/api/v1/user/list、/api/v1/browser/active、/api/v1/browser/local-active、/api/v1/browser/start、/api/v1/browser/stop。默认串行间隔 1100 ms；V2 尚未适配。详情：[API 概览](https://localapi-doc-en.adspower.com/docs/Rdw7Iu)、[启动](https://localapi-doc-en.adspower.com/docs/FFMFMf)、[状态](https://localapi-doc-en.adspower.com/docs/YjFggL)、[列表](https://localapi-doc-en.adspower.com/docs/u8m2Ie)、[官方自动化示例](https://localapi-doc-en.adspower.com/docs/K4IsTq)。

匿名 FBID 仍优先本机 curl，不继承 AdsPower 环境代理；用户明确要求使用环境网络时，选择该环境里的页面查询。Catalog 接口请求在该环境页面内发送，沿用该环境登录与网络配置。

## 1.6.1 页面兼容与真实写入

目录创建、目录改名、单商品 CSV/Feed 导入、商品名称/URL/主图 URL 专用接口已通过本次授权的 AdsPower 实测，详见 catalog.md 与 verification.json。原有 Chrome 模式、广告账户写入限制均保留。

页面助手从可见快照返回 selector、checkbox 状态和菜单选项。支持 CSS、独立 `::-p-text(文字)` 与独立 `::-p-xpath(表达式)`；文本匹配不唯一时使用本次快照的精确 selector。它使用主页面上下文定位和点击，避开本次环境中隔离上下文选择器超时；受控输入用原生 value setter 及 input/change 事件并校验完整值，不依赖多次点击选中默认名称。禁用或不可见的点击目标会被拒绝。

逐条等待 runner 返回，再读取最新页面状态；请求返回不保证 React 页面完成更新。空快照重新读取，勿使用旧菜单位置继续填充。超时后句柄失效，重新连接并回读，不能据此自动重复创建/保存。目录设置页“下一页”是实际创建提交点。
