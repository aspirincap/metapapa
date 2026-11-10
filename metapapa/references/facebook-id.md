# 主页链接查询 Facebook Profile ID

默认先运行 `scripts/facebook_id_public.py`，使用匿名 curl GET 解析公开主页的 Profile ID；无需 Chrome、Cookie、Token 或登录。仅在匿名结果无法核实时，按错误状态及用户范围考虑已登录 Chrome 的同源 GET，最后才是官网 UI 核验。两条程序路线的操作名均为 `facebook.profileId.resolve`，成功请求均为单次 GET。

这是 Facebook 网页请求适配，不是需要 OAuth 应用的公开 Graph API。两条路线均直接访问 Facebook，无需第三方 ID 查询站或独立 MCP。匿名脚本的 HTML 仅用于内存解析，不输出或落盘；Chrome 路线的 HTML、Cookie、Token 留在浏览器内。

## 匿名调用（首选）

依赖 Python 3.10+ 标准库与 curl 7.63+，不需要 Node 或浏览器：

```sh
python3 <skill-dir>/scripts/facebook_id_public.py 'https://www.facebook.com/example.page' --timeout-seconds 15
```

输入为用户提供的 Facebook 主页 URL；示例短名需替换。支持 `facebook.com` / `www.facebook.com` / `m.facebook.com`，规范化到 HTTPS 的 `www.facebook.com`，移除跟踪参数。拒绝外域、凭证、端口、群组、帖子、照片、设置等非主页输入。

成功输出 JSON、退出码 0：

```json
{
  "operation":"facebook.profileId.resolve",
  "status":"resolved",
  "profile_id":"123",
  "id_type":"profile_id",
  "username":"example.page",
  "profile_url":"https://www.facebook.com/example.page",
  "request_url":"https://www.facebook.com/example.page",
  "method":"facebook_public_get_metadata",
  "authenticated":false,
  "evidence_fields":["og:url","al:android:url","al:ios:url"],
  "request_count":1,
  "http_status":200,
  "elapsed_ms":2100,
  "fetched_at":"2026-11-10T00:00:00+00:00"
}
```

校验 HTML `<head>` 中的 `og:url` 与目标短名一致，并从 `al:android:url` / `al:ios:url` 的 `fb://profile/<数字>` 取值；至少一个深链字段存在，所有出现的字段和重复值必须一致。忽略正文、脚本和 template 中的类似片段。数字 URL 还要与深链 ID 一致，但数字格式尚无真实匿名请求验收。不要从正文任意数字、照片 ID、登录者 ID 或故事 bucket 推断。

脚本执行参数数组形式的 curl；`-q` 作为首参数禁用 `.curlrc`，禁用 netrc，不携带 Cookie/Authorization、不使用浏览器资料，不自动跟随重定向。仅允许 HTTPS，默认 15 秒（可设 1–30 秒），最多解析 12 MiB 解压后的响应。只接收 HTTP 200 HTML；不执行页面脚本、不保存 Cookie 或完整 HTML。

失败输出 `status:unresolved`（输入错误为 `invalid_input`）、`code`、`profile_id:null` 与下一步提示，退出码 2；脚本不自动打开 Chrome 或再次请求：

| code | 后续处理 |
|---|---|
| PUBLIC_PROFILE_METADATA_UNAVAILABLE / PROFILE_TARGET_MISMATCH / AMBIGUOUS_PROFILE_METADATA | 无法可靠对应目标；可用 Chrome 路线核验，不返回猜测值 |
| PUBLIC_REDIRECT_REQUIRES_BROWSER | 未跟随重定向；可在官网正常导航查看 |
| PUBLIC_GET_TIMEOUT / PUBLIC_GET_UNAVAILABLE / CURL_UNAVAILABLE | 网络/环境或依赖问题，不代表主页不存在；先辨明环境问题或使用已允许的 Chrome 路线 |
| PUBLIC_ACCESS_DENIED / PUBLIC_HTTP_ERROR / PROFILE_RESPONSE_NOT_HTML | 不能据此判断封号；检查官网实际状态 |
| RATE_LIMITED | 停止本次自动查询，不能换 Chrome 通道规避限流 |
| INVALID_PROFILE_URL / INVALID_TIMEOUT | 更正输入；不发送网络请求 |

用户明确要求“只匿名/不用 Chrome”时，失败后报告未核实，不切换登录路线。允许 Chrome 回退且确需登录时，先按 [onboarding](onboarding.md) 使用正确个号。登录提示可能与公开身份元数据同时出现；有效公开元数据可以直接用于只读结果，没有有效元数据则不尝试登录绕过。

## 已登录浏览器调用（Chrome / AdsPower 回退）

普通 Chrome 按 `browser-workflow.md` 取得 Facebook 标签页 CDP；AdsPower 按 `adspower.md` 取得所选环境的 `tab.cdp`。标签页必须位于 `https://www.facebook.com` 且已经登录；可以停留在其他 Facebook 页面，不必先打开目标主页。

```js
const {createFacebookIdClient} = await import('file://'+SKILL_DIR+'/scripts/facebook-id.mjs');
const ids = createFacebookIdClient({cdp,expectedActorId});
const result = await ids.resolve({
  url:'https://www.facebook.com/example.page', // 示例，替换为用户的目标链接
  timeoutMs:15000
});
// result.profile_id 为字符串，result.id_type === 'profile_id'
```

`expectedActorId` 可省略；省略时客户端绑定首个成功查询的当前身份，后续换号会拒绝。已知预期身份时传入以校验一致性。支持普通主页短名 URL、数字路径及 `profile.php?id=...` 输入，数字 URL 仍可能需要网页核验。`facebook.com` / `m.facebook.com` 统一到 HTTPS 的 `www.facebook.com`，移除跟踪参数和 fragment；拒绝外域、用户密码、帖子、照片、群组、跳转和设置链接。

成功返回：

```json
{
  "operation":"facebook.profileId.resolve",
  "status":"resolved",
  "profile_id":"123",
  "id_type":"profile_id",
  "username":"example.page",
  "profile_url":"https://www.facebook.com/example.page",
  "request_url":"https://www.facebook.com/example.page",
  "method":"facebook_web_get_route",
  "request_count":1,
  "elapsed_ms":1600,
  "fetched_at":"2026-11-10T00:00:00.000Z"
}
```

这是当前主页的 **Profile ID**。不要把它自动解释为旧 Page ID、广告账户 ID、帖子/图片 FBID；调用其他接口时仍须核对所需对象类型。

## Chrome 路由校验

2026-11-10 实测的响应数据路径为：`initialRouteInfo.route.rootView.props.userID`。

同时核对：

- `canonicalRouteName` 为 `comet.fbweb.CometProfileTimelineListViewRoute`。
- 根视图的 entrypoint/resource 为 `ProfileCometTimelineListViewRouteRoot.entrypoint` / `ProfileCometTimelineListViewRoot.react`。
- `route.url`、`params.vanity`、`rootView.props.userVanity` 与输入短名一致。
- 存在 `hostableView` 时，它的身份字段也必须一致；多份匹配路由不能相互冲突。

不从任意 `id`、`viewerID`、登录者 `profile_id`、图片链接或 `DirectMessageThreadBucket` 中猜答案。代码只解析 JSON，不执行响应中的脚本；请求前后检查登录身份，只返回最小身份结果。

## Chrome 失败回退

没有可核实结果时抛出带 `code` 的错误，不返回猜测值，不自动重试或换接口：

- `PROFILE_ROUTE_NOT_FOUND` / `PROFILE_ROUTE_CONFLICT` / `AMBIGUOUS_PROFILE_ROUTE`：官网结构变化或对应关系不明确，转正常主页 UI 核验。
- `PROFILE_GET_UNAVAILABLE`：可能为重定向、网络或浏览器限制，转正常导航查看；不要以此判定账号不存在。
- `LOGIN_REQUIRED` / `LOGIN_OR_CHALLENGE_REQUIRED` / `ACCESS_DENIED` / `RATE_LIMITED`：按官网状态处理，不绕过挑战或连续请求。
- `FACEBOOK_WWW_PAGE_REQUIRED` / `IDENTITY_CHANGED`：先选择正确标签页和登录身份。

数字 ID 的本地语法提取仍可用 `toolbox.py facebook.id`，但 `ownership_verified:false` 不代表身份已验证。需要真实核实时，以官网证据为准。

## 实测范围

1.5.0 匿名脚本于 2026-11-10 实测一个公开短名：HTTP 200，Android/iOS 深链与 `og:url` 一致，Profile ID 与之前 Chrome 查询相同，耗时 2117 ms。此前手动匿名 curl 单次测试约 4.6 秒；不能据此宣称匿名路线总比 Chrome 更快，其优势是免登录和浏览器依赖。13 项新增离线测试覆盖目标绑定、冲突、脚本/正文排除、HTTP 状态、响应大小、curl 无认证参数与单次请求。未对 onboarding 做退出/重登测试，流程复用现有只读 `inspectSession()`，没有改动用户登录。

1.4.0 Chrome 路线于 2026-11-10 对两个公开短名主页各一次 GET 成功，耗时分别 1585 ms 和 2006 ms；第一项与此前网页身份数据核对一致。另一个数字格式 URL 的直接请求未成功，已记录为 `needs_ui`。这些时间是浏览器内请求、读取和解析耗时，不包含工具启动，也不是正式 UI 对照基准。

8 项新增离线测试覆盖链接限制、目标路由绑定、不同 ID 的区分、冲突、会话变化、限流/挑战、单次请求和输出最小化。未验证所有主页类型、地区和登录环境；不做跨任务长期缓存。
