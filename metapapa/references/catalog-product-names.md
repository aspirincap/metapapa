# Catalog 商品改名接口

商品名称修改优先调用 `scripts/catalog-products.mjs` 的 `createCatalogProductNameClient`。它复用 Chrome 官网会话，使用 `catalog.products.names.update` 专用操作，支持 `plan`、`execute`、`reconcile` 和 `planRestore`。这不是目录改名、SKU 改名或广告改名；SKU 和 Meta 商品 ID 保持不变。

2026-11-10 已通过实际单商品临时改名与恢复测试：两次均 `success:true`、`updated_items:1`、`created_items:0`、`errors:[]`；Graph `name` 与网页详情 `Name.stringValue` 双重回读匹配，其他已读取字段不变。新增 5 项离线测试覆盖字段映射、名称校验、恢复、部分失败、回读冲突和误改图片。多商品 mutation 尚未生产验收。

## 使用

按 `catalog-product-urls.md` 准备同身份的 `cdp`（目标 Commerce Manager 目录页）和 `readClient`（通常在 Ads Manager 页），加载当前官网编辑器的 Relay 定义。已有明确改名授权直接执行，不重复请求确认。

```js
const {createCatalogProductNameClient} = await import('file://'+SKILL_DIR+'/scripts/catalog-products.mjs');
const names = createCatalogProductNameClient({cdp,readClient,expectedActorId});
const proposal = await names.plan({
  catalogId,feedId,
  updates:[{productId,retailerId,name:requestedName}]
});
// 只读计划包含原名和精确变更，名称已一致时自动跳过。
const result = await names.execute(proposal,{
  authorizedPlanId:proposal.id,
  journalPath:TASK_DIR+'/product-rename.json'
});
```

名称为 1–200 个 UTF-16 单元（与 JavaScript 字符串长度一致），不允许纯空白、首尾空白或控制字符。内部空格、中文、普通标点保留原样；不自动改写名称或添加营销描述。每批 1–50 件是本地操作限制。客户端核对目录归属、SKU、可选 Feed、类别、身份、原值；当前仅适配普通未分类、无伙伴集成的商品，其他情况转官网流程。

响应及恢复语义与图片客户端相同：只有 `verified` 表示业务响应与回读均通过；`noop` 没有提交。部分成功、断连、回读失败先只读核验，不重放。

```js
await names.reconcile(TASK_DIR+'/product-rename.json');

// 仅在用户要求恢复或明确授权往返测试时：
const restore = await names.planRestore(TASK_DIR+'/product-rename.json');
await names.execute(restore,{
  authorizedPlanId:restore.id,
  journalPath:TASK_DIR+'/product-rename-restore.json'
});
```

`planRestore` 只生成计划，不自动写入；当前名称已被改为第三个值或其他已读取字段变化时，返回 `RESTORE_CONFLICT`。不能用旧日志覆盖他人后续编辑。截图与最终 UI 核对依当次浏览器工具要求完成。

## 字段与请求

写入字段为 **`title`**，Graph 读取字段为 **`name`**，网页详情属性为 **`Name.stringValue`**，三者不能混淆。`base_fields_data.id` 仍为 retailer SKU；读取 `ids` 则为 Meta 商品数字 ID。

`POST https://business.facebook.com/api/graphql/`，friendly name `CatalogBulkItemEditorHooksBulkItemUpdateMutation`，本次核对的 doc_id `29601050282817196`。

```json
{
  "input": {
    "catalog_id": "123",
    "is_showing_canonical_price": false,
    "item_data": [{
      "base_fields_data": {"id": "EXAMPLE-SKU", "title": "用户指定的新名称"},
      "extended_fields_data": [],
      "item_sub_type": null
    }],
    "use_case": "BULK_EDITOR",
    "version": ""
  },
  "shouldReturnUpdatedProductItems": false
}
```

只发送 SKU 与 title，不把价格、URL、图片或整行旧数据回填。调用使用当前网页 Cookie/CSRF，凭证不出浏览器。操作定义与会话变更时停止，不能猜 doc_id。来源 Feed 下一次上传仍可能覆盖手动名称；本接口不修改原 CSV。
