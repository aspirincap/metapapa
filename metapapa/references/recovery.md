# 错误与恢复

| 代码/状态 | 处理 |
|---|---|
| LOGIN_REQUIRED / WEB_SESSION_UNAVAILABLE | 按 [onboarding](onboarding.md) 保留页面、引导用户完成官网登录或挑战后重新 inspectSession。不要索取导出的 Cookie。 |
| IDENTITY_CHANGED / TOKEN_IDENTITY_MISMATCH | 立即停止后续动作，说明人已切换或 Token 无法绑定当前人；重新核对目标并建立新 client。 |
| PAGE_ORIGIN_MISMATCH | 在对应 www/business 页面取得该页 CDP。不能改 request origin 逃过限制。 |
| PAGE_TOKEN_UNAVAILABLE / AMBIGUOUS_PAGE_TOKEN | 当前页面无唯一可验证的 Token；改用已登录的 Ads Manager 正常页面或 UI 流程。 |
| META_BUSINESS_ERROR / HTTP_ERROR | 读取已脱敏错误代码，区分权限、限流、字段/doc_id 失效、业务校验；只读可在解决原因后重试。 |
| RESPONSE_NOT_JSON / SCHEMA_CHANGED | 可能登录页、挑战页或协议变化；检查当前页面与实际流量，不把空对象判为成功。 |
| JOURNAL_EXISTS / PLAN_NOT_AUTHORIZED | 不覆盖任务日志；先 reconcile。计划已执行、被改动或并发消费时必须重新核对。 |
| NETWORK_RESULT_UNKNOWN / BROWSER_RESULT_UNKNOWN | 请求可能已生效。查询确切对象/关系，不能把“超时”当成“没提交”。 |
| needs_verification / mismatch | 不是完成。根据预期字段回读或核对界面，报告实际差异。 |
| page_limit / request_failed / cursor_missing_or_repeated | 导出当前数据并保持 complete:false，保存 cursor；不得静默丢失分页错误。 |

`client.reconcile(journalPath)` 始终只读；对具备回读方法的操作返回当前结果和 expected，未具备的返回目标信息和页面核对建议，不重发 mutation。它不会仅凭一次 readback 就覆盖此前日志结论。

每次批量任务保存 item → operation → journalPath 对照。恢复时只处理未尝试项；对 attempting/unknown/needs_verification 先逐项对账，防止重复建资产、邀请或导入。没有自动循环重试写入的守护进程。

协议维护：复制失败样本时只保留业务错误与必要字段结构，去掉完整 HTML、令牌、Cookie、上传 handle、私人字段。更新 `references/catalog-operations.json` 或 `scripts/lib/graphql.mjs` 的操作时补对应模拟测试，并把旧实测状态撤回，实际只读通过后更新 verification。

## AdsPower 与写入策略

- `AD_ACCOUNT_WRITES_FORBIDDEN`：广告账户或对象类型不明的权限写入被拒绝，未提交；不要用 UI、standard 策略或原始请求绕过。
- `READ_ONLY_MODE`：当前任务仅只读；只有新的明确 Catalog 写入任务才能以 catalog_write 建立连接。
- `BROWSER_PROFILE_MISMATCH`：日志/计划来自另一浏览器环境；即使 Facebook 个号相同也须回原环境对账。
- `ADSPOWER_AUTH_REQUIRED` / API authentication 错误：检查本机 Local API Key 与权限；不要在日志打印 Key。
- `ADSPOWER_NETWORK_UNCONFIRMED`：区分工具沙箱权限、服务未启动和网络异常；不是 Facebook 登录错误。
- `ADSPOWER_START_RESULT_UNKNOWN`：已检查启动状态但仍不确定，不重复 start；让用户检查 AdsPower 窗口。
- `ADSPOWER_PAGE_RESULT_UNKNOWN`：页面调用可能已发生，旧句柄停止使用；重新连接并只读对账，不重放写入。
- `ADSPOWER_RATE_LIMITED`：停止自动请求，不换模式或环境规避。

连接与登录恢复见 [AdsPower](adspower.md) 和 [onboarding](onboarding.md)。
