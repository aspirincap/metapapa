# 浏览器调用方法（保留现有 Chrome）

本文件说明客户端契约；浏览器 API 以当次工具返回文档为准。首次使用、身份不明或换号先读 [onboarding](onboarding.md)，核对 Chrome 中本次要用的个人账号。入口脚本是 ES module，依赖 Node 20+；Python 工具要求 3.10+。不需要 npm install。匿名 FBID 查询无需本流程，见 [FBID](facebook-id.md)。

AdsPower 使用 [专用连接层](adspower.md) 提供的 `tab.cdp`，业务客户端契约相同。以下连接步骤仍适用于普通 Chrome；不要因加入 AdsPower 而替换用户已选的 Chrome。

## 连接

1. 通过 `cua_repl` 获取用户指定 Chrome。读取其首次文档，命名会话，识别已有用户标签页，取得所需标签页；不跳到内部浏览器。原页面有编辑草稿时用新标签页。
2. 读标签页当前状态，取得 `await tab.capabilities.get('cdp')` 并读取文档。它必须支持 `send('Runtime.evaluate', ...)`。缺此能力时使用官方页面 UI，不能私自另建浏览器桥。
3. 在同一工具执行环境加载以下模块。`SKILL_DIR` 是当前实际 Skill 目录的绝对路径，不是固定机器路径。模块导入与文件读取可以在 Node 环境完成；网页交互始终由已取得的浏览器工具句柄执行。

```js
const {createMetaClient} = await import('file://' + SKILL_DIR + '/scripts/client.mjs');
const client = createMetaClient({cdp,expectedActorId,writePolicy:'no_ad_account_writes'}); // 来自本次 onboarding 核对
const session = await client.inspectSession();
// 确认本次 actor_id；用于后续目标标签页 expectedActorId，不需要打印身份姓名。
const accounts = await client.paginate('accounts.list', {}, {maxPages:20, delayMs:350});
```

Graph 操作优先放在已加载的 Ads Manager 页；其中通常有网页会话 Token。客户端只接受页面中唯一候选，并用同源 Graph `/me` 校验，随后直接请求 Meta。FQL 操作要求 `www.facebook.com` 标签页，BQL 要求 `business.facebook.com` 标签页。不同 origin 创建独立 client，传同一 `expectedActorId`。页面找不到 Token 时转官方网页，不向用户索取 Cookie。

## 读操作

```js
const result = await client.query('accounts.get', {accountId});
const report = await client.paginate('ads.insights.query', {
  accountId, since:'2026-10-01', until:'2026-10-31', level:'campaign'
}, {maxPages:40}); // 日期是示例，必须替换成用户范围
await client.exportResult(TASK_DIR+'/insights.json', report);
```

所有 Facebook ID 用字符串。分页返回 `{data,pages,complete,reason?,cursor?}`。遇到页数上限、限流、取消、结构变化或重复游标，`complete:false`；已取得数据可交付但必须说明不完整。默认每页间隔 350ms，不并行轰炸账户。

GraphQL 的 `*.page` 操作是**显式单页**，不会猜嵌套连接：读取返回的 `page_info`，根据 `has_next_page/end_cursor` 传下一页 `cursor`，逐页累计，遇到缺失/重复游标停止并标记不完整。`query` 返回数据包装为 `result.data`，GraphQL 业务层通常位于 `result.data.data`。

## 写操作

默认 `no_ad_account_writes` 拦截广告账户、广告状态、账户关联及对象类型不明的权限变更；`read_only` 拦截所有写入。不得因 UI 或 AdsPower 路线不同绕过用户的禁止范围。下方示例只适用于允许的其他业务写入。

```js
// 示例：仅在用户明确授权隐藏该评论时；广告账户写入被默认策略拦截。
const proposal = await client.plan('comments.hide', {commentId});
// 展示 proposal 中的身份、目标、原值→新值，并核对用户明确授权与浏览器工具规则。
const result = await client.execute(proposal, {
  authorizedPlanId:proposal.id,
  journalPath:TASK_DIR+'/hide-comment-001.json'
});
```

`authorizedPlanId` 是程序防误调用机制，不代表用户已授权。调用方必须从对话获得授权。计划只能执行一次；修改计划、换身份、重用日志都会被拦截。批量任务逐项新计划、新日志，按已授权范围处理；统计成功、待核验、失败及未提交数量，不因为有失败自动重试写入。

历史代码具有账户名称、花费限额、广告启停回读能力，但当前这些写操作已被默认策略禁用；其他写操作返回 `requires_business_verification` 并保存 `needs_verification`，随后用对应关系查询/官方页面核验。创建返回 ID 只说明收到响应，仍须验证归属、名称及界面结果。

金额 `accounts.spendCap.set.amount` 是接口单位的十进制字符串。先读账户币种与页面显示单位并核对换算，不能把用户说的“100 美元”直接当作接口字符串 100。币种和时区变更应先用官方页面确认对现有账户的影响。
