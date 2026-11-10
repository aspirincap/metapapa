# 客户端功能与接口文档

版本 1.6.1。共 77 个命名操作；这不是 77 个已生产验证的 API。Graph/GraphQL 均在选定 Chrome 或 AdsPower 网页会话内调用，接口版本与 doc_id 是快照，可能随 Meta 页面变化。

所有 ID 必须是字符串。下方 `?` 表示可选；请求字段与示例见同目录 `capabilities.json`。JSON 示例中的 111/123 均为虚构 ID，必须替换。客户端方法、分页、授权、错误见 browser-workflow.md 和 recovery.md。

| 操作 | 功能 | 读/写 | 参数 | 请求 | 验证 |
|---|---|---|---|---|---|
| `identity.me` | 当前网页 Token 的 Facebook 身份 | 读 | 无 | GET https://adsmanager-graph.facebook.com/v16.0/me | 历史 Chrome 只读通过 |
| `accounts.list` | 广告账户列表 | 读 | `limit?`, `after?` | GET https://adsmanager-graph.facebook.com/v16.0/me/adaccounts | 历史 Chrome 只读通过 |
| `accounts.get` | 广告账户详情 | 读 | `accountId` | GET https://adsmanager-graph.facebook.com/v16.0/act_{targetId} | 历史 Chrome 只读通过 |
| `accounts.access` | 账户人员与权限原始关系 | 读 | `accountId` | GET https://adsmanager-graph.facebook.com/v16.0/act_{targetId} | 已实现；待实测 |
| `accounts.spendCap` | 账户花费限额 | 读 | `accountId` | GET https://adsmanager-graph.facebook.com/v16.0/act_{targetId} | 历史 Chrome 只读通过 |
| `accounts.rename` | 重命名广告账户 | 写 | `accountId`, `name` | POST https://adsmanager-graph.facebook.com/v18.0/act_{targetId} | 默认禁止（广告账户/权限写入） |
| `accounts.spendCap.set` | 设置账户限额，保持接口金额单位 | 写 | `accountId`, `amount` | POST https://adsmanager-graph.facebook.com/v16.0/act_{targetId} | 默认禁止（广告账户/权限写入） |
| `accounts.spendCap.remove` | 移除账户限额 | 写 | `accountId` | POST https://adsmanager-graph.facebook.com/v16.0/act_{targetId} | 默认禁止（广告账户/权限写入） |
| `accounts.users.add` | 添加广告账户人员 | 写 | `accountId`, `userId`, `role` | POST https://adsmanager-graph.facebook.com/v16.0/act_{targetId}/users | 默认禁止（广告账户/权限写入） |
| `accounts.users.remove` | 移除广告账户人员 | 写 | `accountId`, `userId` | GET (method=DELETE) https://adsmanager-graph.facebook.com/v16.0/act_{targetId}/users/{targetId} | 默认禁止（广告账户/权限写入） |
| `accounts.partners.add` | 分享广告账户给伙伴 | 写 | `accountId`, `businessId`, `tasks` | POST https://adsmanager-graph.facebook.com/v16.0/act_{targetId}/agencies | 默认禁止（广告账户/权限写入） |
| `accounts.currency.set` | 修改账户币种 | 写 | `accountId`, `currency` | GET (method=POST) https://adsmanager-graph.facebook.com/v16.0/act_{targetId} | 默认禁止（广告账户/权限写入） |
| `accounts.timezone.set` | 修改账户时区 | 写 | `accountId`, `timezoneId` | GET (method=POST) https://adsmanager-graph.facebook.com/v16.0/act_{targetId} | 默认禁止（广告账户/权限写入） |
| `businesses.list` | BM 列表 | 读 | `limit?`, `after?` | GET https://adsmanager-graph.facebook.com/v16.0/me/businesses | 历史 Chrome 只读通过 |
| `businesses.get` | BM 基本资料 | 读 | `businessId` | GET https://adsmanager-graph.facebook.com/v16.0/{targetId} | 历史 Chrome 只读通过 |
| `businesses.members.list` | BM 人员 | 读 | `businessId`, `limit?`, `after?` | GET https://adsmanager-graph.facebook.com/v16.0/{targetId}/business_users | 已实现；待实测 |
| `businesses.systemUsers.list` | BM 系统用户 | 读 | `businessId`, `limit?`, `after?` | GET https://graph.facebook.com/v25.0/{targetId}/system_users | 已实现；待实测 |
| `businesses.accounts.owned` | BM 自有广告账户 | 读 | `businessId`, `limit?`, `after?` | GET https://adsmanager-graph.facebook.com/v16.0/{targetId}/owned_ad_accounts | 已实现；待实测 |
| `businesses.accounts.client` | BM 客户广告账户 | 读 | `businessId`, `limit?`, `after?` | GET https://adsmanager-graph.facebook.com/v16.0/{targetId}/client_ad_accounts | 已实现；待实测 |
| `businesses.pages.owned` | BM 自有主页 | 读 | `businessId`, `limit?`, `after?` | GET https://graph.facebook.com/v25.0/{targetId}/owned_pages | 已实现；待实测 |
| `businesses.partners` | BM 伙伴关系首屏 | 读 | `businessId` | GET https://adsmanager-graph.facebook.com/v16.0/{targetId} | 已实现；待实测 |
| `businesses.accounts.attach` | 将广告账户关联至 BM | 写 | `businessId`, `accountId`, `tasks` | POST https://adsmanager-graph.facebook.com/v16.0/{targetId}/client_ad_accounts | 默认禁止（广告账户/权限写入） |
| `businesses.accounts.remove` | 移除 BM 客户广告账户关系 | 写 | `businessId`, `accountId` | POST https://adsmanager-graph.facebook.com/v16.0/{targetId}/client_ad_accounts | 默认禁止（广告账户/权限写入） |
| `businesses.members.remove` | 移除 BM 人员 | 写 | `businessUserId` | GET (method=DELETE) https://adsmanager-graph.facebook.com/v16.0/{targetId} | 默认禁止（广告账户/权限写入） |
| `pages.list` | 当前身份可访问主页 | 读 | `limit?`, `after?` | GET https://graph.facebook.com/v18.0/me/accounts | 历史 Chrome 只读通过 |
| `pages.get` | 主页基本资料 | 读 | `pageId` | GET https://graph.facebook.com/v18.0/{targetId} | 已实现；待实测 |
| `pages.posts.list` | 主页帖子 | 读 | `pageId`, `limit?`, `after?` | GET https://graph.facebook.com/v18.0/{targetId}/posts | 已实现；待实测 |
| `pixels.list` | BM 自有像素 | 读 | `businessId`, `limit?`, `after?` | GET https://adsmanager-graph.facebook.com/v16.0/{targetId}/adspixels | 历史 Chrome 只读通过 |
| `pixels.get` | 像素详情 | 读 | `pixelId` | GET https://adsmanager-graph.facebook.com/v16.0/{targetId} | 已实现；待实测 |
| `pixels.users` | 像素分配人员 | 读 | `pixelId` | GET https://adsmanager-graph.facebook.com/v16.0/{targetId} | 已实现；待实测 |
| `pixels.partners` | 像素分配伙伴 | 读 | `pixelId` | GET https://adsmanager-graph.facebook.com/v16.0/{targetId} | 已实现；待实测 |
| `pixels.accounts` | 像素可用广告账户 | 读 | `pixelId`, `businessId` | GET https://adsmanager-graph.facebook.com/v16.0/{targetId} | 已实现；待实测 |
| `pixels.accounts.share` | 旧像素共享账户接口 | 写 | `pixelId`, `businessId`, `accountId` | GET (method=POST) https://adsmanager-graph.facebook.com/v16.0/{targetId}/shared_accounts | 默认禁止（广告账户/权限写入） |
| `ads.campaigns.list` | campaigns 列表 | 读 | `accountId`, `limit?`, `after?` | GET https://adsmanager-graph.facebook.com/v16.0/act_{targetId}/campaigns | 历史 Chrome 只读通过 |
| `ads.adsets.list` | adsets 列表 | 读 | `accountId`, `limit?`, `after?` | GET https://adsmanager-graph.facebook.com/v16.0/act_{targetId}/adsets | 已实现；待实测 |
| `ads.ads.list` | ads 列表 | 读 | `accountId`, `limit?`, `after?` | GET https://adsmanager-graph.facebook.com/v16.0/act_{targetId}/ads | 已实现；待实测 |
| `ads.object.get` | 广告对象基本状态 | 读 | `objectId` | GET https://adsmanager-graph.facebook.com/v23.0/{targetId} | 已实现；待实测 |
| `ads.insights.query` | 按明确日期和层级查询指标 | 读 | `accountId`, `since`, `until`, `level?`, `limit?`, `after?` | GET https://adsmanager-graph.facebook.com/v18.0/act_{targetId}/insights | 已实现；待实测 |
| `ads.accountResults` | 账户 am_tabular 结果指标 | 读 | `accountId`, `since`, `until` | GET https://adsmanager-graph.facebook.com/v16.0/act_{targetId}/am_tabular | 已实现；待实测 |
| `ads.status.set` | 修改广告对象启停状态 | 写 | `objectId`, `status` | POST https://adsmanager-graph.facebook.com/v23.0/{targetId} | 默认禁止（广告账户/权限写入） |
| `targeting.search` | 兴趣关键词搜索 | 读 | `accountId`, `query`, `locale?`, `countries?` | GET https://adsmanager-graph.facebook.com/v16.0/act_{targetId}/targetingsearch | 已实现；待实测 |
| `targeting.browse` | 兴趣与人口统计分类 | 读 | `accountId`, `locale?` | GET https://adsmanager-graph.facebook.com/v16.0/act_{targetId}/targetingbrowse | 已实现；待实测 |
| `comments.list` | 帖子评论 | 读 | `postId`, `limit?`, `after?` | GET https://graph.facebook.com/v18.0/{targetId}/comments | 已实现；待实测 |
| `comments.remove` | 删除指定评论 | 写 | `commentId` | GET (method=DELETE) https://graph.facebook.com/v18.0/{targetId} | 已实现；真实写入未验收 |
| `datasets.create` | 创建 Dataset | 写 | `businessId`, `name` | POST https://business.facebook.com/events_manager/dataset/create/ | 已实现；真实写入未验收 |
| `catalogs.list` | BM 自有商品目录 | 读 | `businessId`, `limit?`, `after?` | GET https://graph.facebook.com/v18.0/{targetId}/owned_product_catalogs | 历史 Chrome 只读通过 |
| `catalogs.get` | 商品目录详情 | 读 | `catalogId` | GET https://graph.facebook.com/v18.0/{targetId} | 历史 Chrome 只读通过 |
| `catalogs.products.list` | 商品列表 | 读 | `catalogId`, `limit?`, `after?` | GET https://graph.facebook.com/v18.0/{targetId}/products | 历史 Chrome 只读通过 |
| `catalogs.products.get` | 商品详情 | 读 | `productId` | GET https://graph.facebook.com/v18.0/{targetId} | 已实现；待实测 |
| `catalogs.productSets.list` | 商品集列表 | 读 | `catalogId`, `limit?`, `after?` | GET https://graph.facebook.com/v18.0/{targetId}/product_sets | 历史 Chrome 只读通过 |
| `catalogs.productSets.get` | 商品集详情 | 读 | `productSetId` | GET https://graph.facebook.com/v18.0/{targetId} | 已实现；待实测 |
| `accounts.billing` | 账户支付记录首屏，支持明确时间和游标 | 读 | `accountId`, `startTime`, `endTime`, `cursor?`, `count?` | POST https://business.facebook.com/api/graphql/ · BillingHubTransactionsTableQuery · doc_id=9703820159706447 | 已实现；待实测 |
| `pages.categories.search` | 搜索主页分类 | 读 | `query` | POST https://www.facebook.com/api/graphql/ · usePagesCometAdminEditingCategoryDataSourceQuery · doc_id=9868446276528106 | 已实现；待实测 |
| `pages.roles` | 主页角色，需要明确主页身份 | 读 | `pageId` | POST https://www.facebook.com/api/graphql/ · CometProfilePlusAdminPermissionsRootQuery · doc_id=7549643858456643 | 已实现；待实测 |
| `pages.create` | 创建个人主页 | 写 | `name`, `categoryId` | POST https://www.facebook.com/api/graphql/ · AdditionalProfilePlusCreationMutation · doc_id=23863457623296585 | 已实现；真实写入未验收 |
| `pages.createInBusiness` | 创建 BM 主页 | 写 | `businessId`, `name`, `categoryId` | POST https://www.facebook.com/api/graphql/ · BizKitSettingsCreateAdditionalProfilePlusMutation · doc_id=24040062452298715 | 已实现；真实写入未验收 |
| `businesses.create` | 创建 BM | 写 | `name`, `firstName`, `lastName`, `email` | POST https://business.facebook.com/api/graphql/ · useBusinessCreationMutationMutation · doc_id=7780408488685584 | 已实现；真实写入未验收 |
| `businesses.accounts.create` | 在 BM 创建广告账户 | 写 | `businessId`, `name`, `timezoneId`, `currency` | POST https://business.facebook.com/api/graphql/ · BizKitSettingsCreateAdAccountMutation · doc_id=6547144472027848 | 默认禁止（广告账户/权限写入） |
| `businesses.people.page` | BM 人员及邀请，显式游标单页 | 读 | `businessId`, `cursor?`, `count?`, `search?` | POST https://business.facebook.com/api/graphql/ · BizKitSettingsPeopleTableListPaginationQuery · doc_id=26929347616691112 | 历史 Chrome 只读通过 |
| `businesses.assets.page` | BM 资产列表；保留业务对象 ID 与真实资产 ID | 读 | `businessId`, `assetType`, `cursor?`, `count?`, `search?` | POST https://business.facebook.com/api/graphql/ · BizKitSettingsBusinessAssetsListPaginationQuery · doc_id=24040566188906095 | 历史 Chrome 只读通过 |
| `friends.incoming` | 好友请求首屏；检查嵌套 page_info | 读 | 无 | POST https://www.facebook.com/api/graphql/ · FriendingCometFriendRequestsRootQuery · doc_id=4851458921570237 | 历史 Chrome 只读通过 |
| `friends.outgoing` | 好友请求首屏；检查嵌套 page_info | 读 | 无 | POST https://www.facebook.com/api/graphql/ · FriendingCometOutgoingRequestsDialogQuery · doc_id=7114490868621087 | 历史 Chrome 只读通过 |
| `friends.incoming.page` | 好友请求后续页 | 读 | `cursor`, `count?` | POST https://www.facebook.com/api/graphql/ · FriendingCometFriendRequestsSectionPanelPaginationQuery · doc_id=4843321999100134 | 已实现；待实测 |
| `friends.outgoing.page` | 好友请求后续页 | 读 | `cursor`, `count?` | POST https://www.facebook.com/api/graphql/ · FriendingCometOutgoingRequestsDialogPaginationQuery · doc_id=4420916318007844 | 已实现；待实测 |
| `friends.send` | 处理明确指定的一条好友请求 | 写 | `personId` | POST https://www.facebook.com/api/graphql/ · FriendingCometFriendRequestSendMutation · doc_id=9088570061180773 | 已实现；真实写入未验收 |
| `friends.cancel` | 处理明确指定的一条好友请求 | 写 | `personId` | POST https://www.facebook.com/api/graphql/ · FriendingCometFriendRequestCancelMutation · doc_id=5247084515315799 | 已实现；真实写入未验收 |
| `friends.confirm` | 处理明确指定的一条好友请求 | 写 | `personId` | POST https://www.facebook.com/api/graphql/ · FriendingCometFriendRequestConfirmMutation · doc_id=7296875020421877 | 已实现；真实写入未验收 |
| `friends.delete` | 处理明确指定的一条好友请求 | 写 | `personId` | POST https://www.facebook.com/api/graphql/ · FriendingCometFriendRequestDeleteMutation · doc_id=25467262782918901 | 已实现；真实写入未验收 |
| `datasets.connections.list` | Dataset 关联资产首屏 | 读 | `businessId`, `assetId`, `assetType?` | POST https://business.facebook.com/api/graphql/ · BizKitSettingsAssetToAssetConnectionListContainerQuery · doc_id=9683968218327721 | 已实现；待实测 |
| `datasets.accounts.connect` | 用已核实的资产 ID 连接 Dataset 与广告账户 | 写 | `businessId`, `assetId`, `accountAssetIds` | POST https://business.facebook.com/api/graphql/ · BizKitSettingsBulkAddAssetToAssetConnectionMutation · doc_id=6766079193404375 | 默认禁止（广告账户/权限写入） |
| `datasets.accounts.disconnect` | 移除 Dataset 账户连接 | 写 | `businessId`, `assetId`, `accountAssetId` | POST https://business.facebook.com/api/graphql/ · BizKitSettingsRemoveAssetToAssetConnectionMutation · doc_id=9935288606491185 | 默认禁止（广告账户/权限写入） |
| `assets.partner.validate` | 检查伙伴是否可接收指定资产 | 读 | `businessId`, `assetId`, `partnerBusinessId` | POST https://business.facebook.com/api/graphql/ · BizKitSettingsAddPartnerToAssetByBusinessIDModalValidationQuery · doc_id=9794646500614064 | 已实现；待实测 |
| `datasets.partners.add` | 按明确 task IDs 分享 Dataset；不默认全权限 | 写 | `businessId`, `assetId`, `partnerBusinessId`, `taskIds` | POST https://business.facebook.com/api/graphql/ · BizKitSettingsAddPartnerToAssetMutation · doc_id=27839253259098711 | 默认禁止（广告账户/权限写入） |
| `datasets.users.assign` | 按明确 task IDs 分配 Dataset 人员 | 写 | `businessId`, `assetId`, `userIds`, `taskIds` | POST https://business.facebook.com/api/graphql/ · BusinessToolsAssignUserToAssetModalMutation · doc_id=8519783498080407 | 默认禁止（广告账户/权限写入） |
| `datasets.users.remove` | 移除 Dataset 人员 | 写 | `businessId`, `assetId`, `userId` | POST https://business.facebook.com/api/graphql/ · BusinessToolsRemoveUserAssetConnectionMutation · doc_id=9533151003450644 | 已实现；真实写入未验收 |
| `assets.partners.remove` | 移除指定资产伙伴关系 | 写 | `businessId`, `assetId`, `partnerBusinessId` | POST https://business.facebook.com/api/graphql/ · BizKitSettingsRemovePartnerFromAssetMutation · doc_id=29323358057307636 | 默认禁止（广告账户/权限写入） |
| `comments.hide` | 隐藏指定评论 | 写 | `commentId`, `pageId?` | POST https://www.facebook.com/api/graphql/ · CometUFIHideCommentMutation · doc_id=9037235743033289 | 已实现；真实写入未验收 |

## 当前写入限制

默认 no_ad_account_writes：19 个广告账户/广告状态/账户关联或对象类型不明的权限操作禁止提交；其余写操作仍需具体用户授权。AdsPower runner 默认 read_only。详情见 [AdsPower 适配](adspower.md)。历史 Chrome 实测不自动算 AdsPower 实测。

## 请求与返回契约

Graph：GET 的 query 使用 URLSearchParams，POST body 为 application/x-www-form-urlencoded；数组/对象显式编码。历史 `GET?method=POST/DELETE` 操作仍被注册为写操作，不能通过 query 执行。字段集合保存在 capabilities.json 的 request_example.query.fields；不返回用户凭证。

GraphQL：POST /api/graphql/，由当前页模块生成 __user、av、fb_dtsg、lsd、getAsyncParams；客户端加入 friendly_name、doc_id、variables、server_timestamps。原始 CSRF 与 Cookie 不离开页面。当前快照的 variables 结构见 capabilities.json。

query 返回 `{operation, actor_id, fetched_at, data, pagination}`。Graph 业务对象在 data；列表在 data.data。GraphQL 业务对象通常在 data.data，若多帧响应则在 data.frames，保留原始业务结构，调用方必须验证结果节点。分页 complete 标记仅由 paginate 在所有页成功时给出；单页 query 不声称完整。

plan 返回可审阅参数与请求摘要，不发 mutation。execute 返回 `{operation,actor_id,data,verification,journal_path}`；verification=verified 只用于已实现且吻合的回读，否则保留待核验。journal 先落盘再发请求，未知结果不得重发。

## 参数语义

- accountId 不带 `act_`，由客户端补前缀；businessId 是 BM ID；assetId/accountAssetId 是网页资产对象 ID，可能不同于真实 Pixel/广告账户 ID，需业务页面核实。
- role 历史账户角色值为 1001/1002/1003；实际权限名称先核对页面，不能以编号替代用户授权。taskIds 必须取自当前页面核实的权限项，不默认最大权限。
- 日期 since/until 使用 YYYY-MM-DD 且包含业务时间边界；startTime/endTime 为秒时间戳。report 需要记录账户时区。
- comments 的 postId/commentId 支持数字或数字_数字；GraphQL hide 会转换成所需 comment: Base64 ID。
- `limit` 是单页条数（1..500），`maxPages` 是本次分页预算（1..500），并非收费额度。
- 价格/限额不自动转换币种；商品 price 字段的 Graph 显示格式与 Feed 的 amount currency 格式不同，必须分别处理。

## FBID 专用查询

主页链接到 Profile ID 首选 facebook_id_public.py 的匿名 curl GET，操作名 facebook.profileId.resolve；不需要 Chrome 或登录。未核实时按授权范围完成 onboarding，再用 createFacebookIdClient 同源 GET 或官网 UI 核验。匿名一个、Chrome 两个公开短名已实测。调用及字段见 [FBID 查询接口](facebook-id.md)。

## Catalog 专用接口

| 方法 | 请求 | 状态 |
|---|---|---|
| inspectSession | 本页身份/目录/BM检查 | 本机通过 |
| listFeeds | CatalogDataSourceSelectorV2Query · 24399249673110817 | 本机只读通过 |
| feedDetails | CatalogDataSourcesUnifiedDetailsPageQuery · 39512802991700982 | 本机只读通过 |
| upload | POST business.facebook.com/product_feeds/upload/ · multipart file | AdsPower 单商品真实通过 |
| preview | useCatalogFeedPreviewQuery · 28580915928257609 | AdsPower 单商品真实通过 |
| createFeed | useCreatePrimaryProductFeedMutation · 24497491723184304 | AdsPower 新 Feed 单商品通过 |
| startImport | useCreateProductFeedUploadSessionMutation · 9850218955096775 | AdsPower 新 Feed 单商品通过 |
| checkResult / recordVerified | Feed 回读 + 同一 Feed 界面证据 | 不只检查 HTTP 200 |

Catalog 详细 variables、文件约束、回读及恢复见 catalog.md 和 catalog-operations.json。商品 URL 批量修改由独立 catalog-products.mjs 提供，具体请求、字段映射和核验状态见 [商品链接接口](catalog-product-urls.md)。商品主图 URL 替换使用 createCatalogProductImageClient（含原图恢复计划），见 [图片接口](catalog-product-images.md)。商品改名使用 createCatalogProductNameClient，见 [改名接口](catalog-product-names.md)。其他目录/商品/商品集/URL Feed 的扩展写入由 ui-workflows.md 管理。


## 版本维护

Meta 网页接口版本及 doc_id 是当前实现的快照，可能变化。按每项操作的验收状态使用；生产环境中的成功结果需要业务响应、目标归属及回读共同确认。
