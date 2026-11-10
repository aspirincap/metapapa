# 首次使用与个号登录（Chrome / AdsPower）

用于首次需要登录会话、用户要求“初始化/登录/换个号”、身份不明确、登录过期或身份变化时。匿名 FBID 查询、CSV 预检、报表文件处理及本地工具不要求先登录。用户只要求安装或更新 Skill 时交付此流程，不因此操作他的账号。

## 1. 选择浏览器环境和账号

先沿用用户已选择的浏览器模式。用户提到 AdsPower 或给出环境 ID 时，按 [adspower.md](adspower.md) 检查本机 Local API、核对指定环境并启动/复用它；无需再让用户选普通 Chrome。若两种模式都可用且没有偏好，再询问选择。AdsPower 后续登录、页面核验和业务请求必须留在选定环境，不能悄悄改用普通 Chrome 的另一登录。

以下是普通 Chrome 的选择步骤；AdsPower 用它自己的环境列表替代 Chrome Profile 列表：

读取当次浏览器工具文档，查看可用 Chrome、用户 Profile 和已有 Facebook 标签页。使用用户已指定的 Chrome/Profile；只有一个明确候选时直接检查。存在多个候选且无法确定时，用简短选项让用户选择 Chrome Profile 或本次要使用的 Facebook 个号。Chrome Profile 名称不等于 Facebook 身份。

工具要求时命名浏览器会话。优先复用安全的现有 Facebook 页面；若原页有商品编辑或其他草稿，在同一 Chrome Profile 新开 `https://www.facebook.com/`。使用工具支持的接管/登录交接方式，不改用 Codex 内部浏览器，不从本机 Cookie 文件建立另一套登录。

## 2. 引导用户完成官网登录

检查当前可见页面。未登录时向用户说明：

> 请在选定的 Chrome 或 AdsPower 窗口登录本次要用的 Facebook 个人账号。密码、验证码和安全验证直接在 Facebook 官网完成，完成后告诉我“已登录”。

AdsPower 可先运行 `login_state`。官网若要求从曾登录过的设备解锁，说明该环境当前无法完成解锁；停止业务调用，让用户处理或明确换一个环境。不能自动改用之前的环境。

登录过程中等待用户操作；不要索取密码、Cookie、Token、2FA 密钥或聊天中的验证码，也不要自动调用 TOTP 工具代替本流程。验证码、checkpoint、账号恢复等交还用户处理，不尝试绕过。用户回复后重新读取页面，不能只凭“已登录”就判定成功。

如果已经登录，查看右上角账号菜单的当前身份，核对姓名/个人主页与用户要使用的个号。若当前以公共主页身份使用 Facebook，按官网可见入口引导用户切回个人账号。账号与用户之前明确选择一致时无需重复确认；首次使用且用户未指定账号时，展示当前个人账号的可见名称，询问是否使用它。存在同名时用个人主页链接辅助区分。不要凭目标公共主页的 FBID 推断登录者。

账号不符时让用户在官网切换账号，或者选择已经登录正确账号的另一个 Chrome Profile。不要为 onboarding 擅自退出、移除或注销现有登录。

## 3. 只读核对会话

界面确认个人身份后，普通 Chrome 按 [浏览器连接方法](browser-workflow.md) 取得 CDP；AdsPower 使用连接层返回的 `tab.cdp`。可用时调用现有客户端：

```js
const {createMetaClient} = await import('file://' + SKILL_DIR + '/scripts/client.mjs');
const probe = createMetaClient({cdp,writePolicy:'read_only'});
const session = await probe.inspectSession();
const expectedActorId = session.actor_id; // 本次实际结果；不能写死或使用示例 ID
```

`inspectSession()` 只读页面会话，不查询全部资产，也不提交任何业务变更。它返回的 `actor_id` 是后续身份绑定依据；它本身不识别“个人账号/公共主页”，必须结合前一步的账号菜单。`web_session_ready:true` 只表示页面会话材料已就绪，不保证有所有资产权限或可用的 Graph Token。

继续本次实际业务时，在所需的 Ads Manager / Business / Commerce 标签页建立独立客户端，并传入同一个 `expectedActorId`。先核对该页身份和本次目标 ID，再执行用户要求的只读查询或写入计划。Graph 请求仍须由客户端用 `/me` 绑定 Token。不要把其他账号或其他 Profile 的 Token 混入当前会话。

如果 CDP 或会话模块不可用，但官网 UI 正常登录，可以标记 `ready_ui_only` 并按官方网页流程完成任务，不要求用户导出凭证。`web_session_ready:false` 时不能强行调用依赖这些材料的接口；可先正常加载对应业务页面，再核对一次。

## 4. 完成与后续换号

简短反馈实际结果，例如：“已使用 Chrome 的〈Profile〉，Facebook 个号为〈页面可见名称〉。登录已核对，可以继续这次 Catalog 任务。”只向用户展示必要的身份提示，不导出整个会话对象或 Cookie。

在当前任务内保留浏览器模式、Chrome Profile 或 AdsPower 环境 ID、个人身份提示、`expectedActorId` 与核对时间；它们不是凭证。无需另建账户数据库或保存登录标志。新对话、换环境、网页重登时重新只读核对，不能靠之前的 ready 状态省略检查；既有明确偏好仍有效，不需反复问用户。AdsPower 在任务结束断开控制，默认保留窗口。

出现 `IDENTITY_CHANGED` / `TOKEN_IDENTITY_MISMATCH` 时暂停该身份的后续请求，重新走账号核对并创建新客户端。旧写入计划不可跨身份复用；已有未知结果先按 [恢复流程](recovery.md) 在原身份下只读对账。

此流程的就绪状态只表示登录/浏览器可用，不是创建广告、修改商品、邀请或分享资产的授权。没有为 onboarding 新建或修改 Meta 资产的检查步骤。

本 Skill 当前禁止 Facebook 广告账户写入；这一限制同时适用于 Chrome、AdsPower 和 UI 路线。登录检查使用 read_only；Catalog 真实写入另按具体用户请求授权。
