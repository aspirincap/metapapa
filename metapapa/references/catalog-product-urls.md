# Catalog 商品链接：网页接口批量更新

同一目录内修改商品落地页 URL，优先用 `scripts/catalog-products.mjs` 的 `createCatalogProductUrlClient`。它复用现有 Chrome 的官方网页会话，通过一次批量请求提交变更，不再逐行填写网页。读取、提交前检查及回读仍会产生请求；没有测量或承诺固定提速倍数。

本模块是独立的 Catalog 专用客户端，不在通用 `client.capabilities()` 的 77 项注册表中。仅改商品 URL，不创建/删除商品，不更改原 CSV、Feed 地址或上传计划。**来自 Feed 的手动覆盖仍可能被下一次 Feed 上传覆盖。** 用户要求长期修正源数据时，另外按其授权更新原 CSV/Feed，不能把商品覆盖当成源文件已修改。

## 核验状态与适用范围

- 2026-11-10：已核对官网加载的保存模块、Relay 定义、SKU/字段映射；只读详情接口及完整预检已真实调用。
- 真实预检匹配了 4 件商品的目录归属、Feed、SKU、Meta ID 和现有 URL，发现 URL 已一致，跳过 4 件，新增写入 0。
- 同日随后执行用户授权的真实单商品往返测试：URL 恢复原地址、再改回目标地址，两次均 `success:true / updated_items:1 / errors:[]`，客户端逐项回读全部通过。**单商品直接写入已实测**；多商品 mutation、其他类别不由此自动获得生产验收。
- 图片 URL 替换及恢复也已实际通过同一 mutation，具体区别与操作程序见 [图片替换](catalog-product-images.md)。
- 当前自动适配范围：普通 `ProductItem`，`fbProductCategory` 为空或 null、没有伙伴集成详情、默认版本。已有分类商品需要核对官网 category → item_sub_type 映射，目前返回 `CATEGORY_ROUTE_UNCONFIRMED`，走官网编辑器，不能删除分类来适配此客户端。
- 每批 1–50 件是本地操作限制，不是 Meta 公布的 API 配额。超过时按任务分批，每批独立日志；部分成功或结果不明先核验，不继续重放该批。

## 使用流程

1. 核实用户授权的目录、Feed（若指定）、SKU 范围和目标 URL。已有明确修改授权无需再问一次。
2. 使用正确 Chrome Profile。`readClient` 是已有 `createMetaClient`，可绑定 Ads Manager 页完成 Graph 商品分页读取；`cdp` 绑定同一身份的目标 Commerce Manager 目录页。两个客户端都必须匹配 `expectedActorId`。
3. 首次可从官网商品列表打开所选商品的 Edit 页，只加载页面、不填写或保存，使当前页面加载两个 Relay 操作定义。页面模块未加载、doc_id 改变时客户端会拒绝提交；读取当前官方定义/请求，核对兼容性后再更新代码，禁止枚举 ID。
4. `plan` 完整读取目录商品，核对 SKU → Meta ID 唯一映射，再通过官网批量详情查询检查 Feed 和当前字段。自动跳过已是目标 URL 的商品。将变更数量及 Feed 覆盖语义告知用户；不重复索取已经给出的授权。
5. 在授权范围内 `execute`。它再次检查身份、协议及原值，发现页面切换或他人更改时停止。只有 `status === 'verified'` 才报告全部完成。截图按当前浏览器工具规则获取；最终页面刷新/查看仅用于呈现结果，不再次点击保存。

```js
// 所有 ID、SKU 和 URL 均来自当前任务，不沿用文档中的示例资产。
const {createCatalogProductUrlClient} = await import('file://'+SKILL_DIR+'/scripts/catalog-products.mjs');
const urls = createCatalogProductUrlClient({cdp,readClient,expectedActorId});
const proposal = await urls.plan({
  catalogId, feedId, // 没有 Feed 范围时可省略 feedId
  updates: selectedProducts.map(p=>({
    productId:p.id, retailerId:p.retailer_id, url:targetUrl
  }))
});
// 只展示必要字段；不要把整个目录或会话材料输出给无关目的地。
const review = {changes:proposal.changes,skipped:proposal.skipped,warning:proposal.warning};
// 用户已经授权这些精确变更时继续；否则先完成 review 再询问缺失的授权。
const result = await urls.execute(proposal,{
  authorizedPlanId:proposal.id,
  journalPath:TASK_DIR+'/product-url-update.json'
});
```

计划只能消费一次；已有日志路径会阻止再次提交。原值在计划后变化时重新只读检查，不盲目覆盖。只读验证场景停在 `plan`，不调用 `execute`。

## 官网接口文档（网页内部协议）

两项均为当前登录页面内 `POST https://business.facebook.com/api/graphql/`，表单编码。公共字段由 `transport.mjs` 在网页内填写：`fb_api_caller_class=RelayModern`、`fb_api_req_friendly_name`、`doc_id`、JSON 字符串 `variables` 及当页会话字段。Cookie、CSRF 不出浏览器；不导出令牌，无需外部 OAuth 应用。不得把完整请求头或会话字段写入日志。

| 用途 | friendly name | 本次核对的 doc_id | variables |
|---|---|---|---|
| 批量读商品详情 | `useCatalogItemsByIdsQuery` | `28858660767135028` | `{ids:[Meta商品ID],versionFilter:""}` |
| 批量更新 | `CatalogBulkItemEditorHooksBulkItemUpdateMutation` | `29601050282817196` | 下方结构 |

```json
{
  "input": {
    "catalog_id": "123",
    "is_showing_canonical_price": false,
    "item_data": [{
      "base_fields_data": {"id": "EXAMPLE-SKU", "link": "https://example.com/new"},
      "extended_fields_data": [],
      "item_sub_type": null
    }],
    "use_case": "BULK_EDITOR",
    "version": ""
  },
  "shouldReturnUpdatedProductItems": false
}
```

`base_fields_data.id` 是 **retailer SKU**；查询 `ids` 是 **Meta 商品 ID**。URL 的写入字段是 `link`，读取时为 `attributes[name=ProductURL].urlValue`，通用 Graph 查询中则是 `url`。只发送 SKU 和 link，不能把读取到的价格、标题等整行原样回填。`item_sub_type:null` 仅用于已核实无分类的当前路线。

读取响应：`data.nodes[]` 中检查 `id`、`__typename`、`productFeed.id`、`fbProductCategory` 和 `attributes`。`RetailerID.stringValue` 提供 SKU，`ProductURL.urlValue` 提供链接。

写入响应：`data.bulk_update_items` 对应官网字段 `xfb_catalog_product_items_bulk_update`，包括 `success`、`created_items`、`updated_items`、`affected_product_items`、`errors[{code,message,type,retailer_id}]`。HTTP 200 不等于成功。当前客户端要求成功标记、无错误、更新数符合本批，并逐项回读 URL、SKU、Feed 和其余已读取属性；意外改动任何属性均报告待核验。未被查询的字段不在校验保证内。

## 中断与部分成功

- `noop`：所有链接已经一致，没有发送 mutation。
- `verified`：业务响应确认本批数量，且所有回读检查通过。
- `state_verified_response_unconfirmed`：当前字段已符合目标，但提交响应缺失/不充分。报告状态已核对、提交回执不完整，不自动重发。
- `needs_verification`：部分失败、读回失败或不符合目标。使用逐项结果和日志核对；不得把失败当成全批回滚。

```js
// 可在新客户端实例中执行；只有读取，不重放 mutation。
const reconciliation = await urls.reconcile(TASK_DIR+'/product-url-update.json');
```

若只有部分成功，先只读确认成功和失败清单，再在仍有效的用户授权范围内为剩余商品生成新计划和新日志。不要对整批自动重试。接口过期、登录挑战、权限不足、限流或类别不适配时，转当前官网编辑流程；不尝试猜测新版参数。

协议来源为官网 `CatalogBulkItemEditorUploadRequest`、`CatalogBulkItemEditorRequestDataUtils` 和 Relay artifact。此处是观察到的内部网页协议，不是 Meta 对外稳定 API 承诺。
