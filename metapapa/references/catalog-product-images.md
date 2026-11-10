# Catalog 主图 URL 替换

**图片替换优先调用 `scripts/catalog-products.mjs` 导出的 `createCatalogProductImageClient`，不逐行操作图片编辑 UI。** 此专用客户端提供 `plan`、`execute`、`reconcile`、`planRestore`，操作名为 `catalog.products.images.update`；它不在通用 `client.capabilities()` 的 77 项注册表中。URL 客户端仍只接受 `url`；图片客户端接受 `imageUrl`，不能混用。

2026-11-10 已在用户授权下，通过同一网页协议将目标商品主图换成来源商品主图，再恢复原主图。两次均 `success:true`、`updated_items:1`、`created_items:0`、`errors:[]`，Graph `image_url` 与目标一致，其他已读取字段与来源商品未变。1.2.0 将该协议封装为上述客户端，新增 8 项离线测试；1.3.0 又用新找到的 Pexels 公开图片，实际调用该客户端完成换图与 planRestore 恢复，全部回读通过。单商品客户端已实测，多商品 mutation 尚未生产验收。

## 已确认的区别

- 使用同一个 `CatalogBulkItemEditorHooksBulkItemUpdateMutation`（本次 doc_id `29601050282817196`），通过 `extended_fields_data` 的 `image_link` 设置可访问的图片 URL。
- **不要把商品详情 `images[].id` 当作 `uploaded_image_id`。** 本轮复用另一件商品的图片 ID：先遇到请求超时，回读未变化；改用官网媒体 URI 后返回 `FATAL`、更新数 0。随后省略上传 ID、使用原始图片 URL 才成功。不能概括为所有图片 ID 永远不可用，但本路线禁止这样复用。
- 新本地图片上传返回的媒体句柄是另一类输入，本轮没有验证上传过程或新上传句柄的写入；需要从当前官网上传流程核对。
- CDN `images[].uri` 是展示链接，可能含签名并过期。已验证路线使用 Graph `image_url` 中的原始图片源 URL。不要把临时 CDN URL 当作长期数据源。

## 当前自动操作边界

仅对普通未分类商品、无伙伴集成、**单主图且没有其他图片/视频**使用此客户端；不符合时会拒绝提交。来源图片由用户指定 URL/SKU 或从其指定来源取得，本地文件须先经获授权的官网上传流程取得有效来源，不能直接传文件路径。每批 1–50 件是本地限制；超出时分批独立记录。读取遇到多图、视频、分类或合作平台时，不能用模板中的空数组清除媒体；先按官网当前结构设计保留原媒体的请求，否则转页面操作。

请求是手动覆盖，下一次 Feed 上传仍可能覆盖。替换图片不修改来源商品、不更新原 CSV，也不自动改变落地页 URL。

## 客户端调用

`cdp` 绑定目标 Commerce Manager 目录页，`readClient` 是同一 Chrome 身份的 `createMetaClient`，通常绑定 Ads Manager 页；其配置与 Relay 模块加载方式见 `catalog-product-urls.md`。

```js
const {createCatalogProductImageClient} = await import('file://'+SKILL_DIR+'/scripts/catalog-products.mjs');
const images = createCatalogProductImageClient({cdp,readClient,expectedActorId});

// 如果用户指定另一件商品为图片来源，先从当前目录列表核实该 SKU 的 Meta ID，
// 再读取它的原始源 URL；不要复制 images[].id 或临时 CDN uri。
const source = await readClient.query('catalogs.products.get',{productId:sourceProductId});
const proposal = await images.plan({
  catalogId,feedId, // 没有 Feed 范围时可省略 feedId
  updates:[{productId:targetProductId,retailerId:targetSku,imageUrl:source.data.image_url}]
  // 用户直接提供图片 URL 时，将 imageUrl 设为该 URL。
});
// plan 已校验目录成员、SKU、Feed、类别及媒体形态，并记录原图和其他字段。
// 审核 proposal.changes / proposal.before；已有明确授权即可继续。
const result = await images.execute(proposal,{
  authorizedPlanId:proposal.id,
  journalPath:TASK_DIR+'/image-replace.json'
});
```

`plan` 仅查询，跳过图片 URL 已一致项；`execute` 提交前重新读值，有变化即停止。日志先备份原图 URL/媒体 ID/已读取字段，再发一次请求；不会保存图片二进制。回读同时检查 Graph `image_url`、SKU/Feed、图数/视频以及非图片字段。新的 Meta 图片 ID 可以与旧值不同，不能据此判定恢复失败。

结果状态沿用 URL 客户端：`verified` 为响应与回读均通过；`noop` 未提交；`state_verified_response_unconfirmed` 为目标状态已匹配但回执不完整；`needs_verification` 为部分失败、延迟处理或回读不符。只读核验：

```js
await images.reconcile(TASK_DIR+'/image-replace.json'); // 不重放请求
```

用户要求恢复时，从日志生成新计划，再按已有恢复授权提交，使用新的日志路径：

```js
const restore = await images.planRestore(TASK_DIR+'/image-replace.json');
const restored = await images.execute(restore,{
  authorizedPlanId:restore.id,
  journalPath:TASK_DIR+'/image-restore.json'
});
```

`planRestore` 本身不写入；若当前图已被改为第三个 URL，或非图片字段发生变化，会报 `RESTORE_CONFLICT`。原图已经恢复时可生成跳过计划。它只接受本客户端的同身份日志，不能直接消费早期手工测试日志；历史日志需先核对来源，再用普通 `plan` 准备明确恢复目标。没有恢复要求时不自动回滚成功修改。

## 执行与核验要点

1. 沿用 `catalog-product-urls.md` 的身份、目录、Feed、SKU/Meta ID 和当前 Relay 操作校验。目标、来源必须来自当前只读结果，不能沿用历史图片 ID。
2. 通过 `catalogs.products.get` 读取目标/来源的 `image_url` 及完整已支持字段；通过 `useCatalogItemsByIdsQuery` 读取 `images`、`videos`、SKU、Feed 和属性。验证每件只有一张图、无视频，保存原始源 URL、全部已读取字段和用户指定的最终状态。
3. `imageUrl` 必须是用户授权的 HTTP(S) 绝对 URL，不含账户密码。使用 `plan` / `execute` 的计划校验及唯一日志；既有授权直接继续，不重复询问。
4. 客户端复用 Chrome 页面会话，图片提交采用 `timeoutMs:45000`。不因等待时间更长而自动重试；权限、登录挑战和限流按当前官网处理。
5. 检查嵌套 `data.bulk_update_items`，不是只看 HTTP 状态或 `transport` 返回正常。无论响应成功、业务失败或断连，都只读回查目标的 `image_url`、图数/视频、其余字段与来源商品。成功须响应与读回同时吻合；如果媒体处理中，有限次数只读等待，不重发写入。
6. 需要恢复的测试，替换确实生效后使用原始 `image_url` 生成独立恢复计划/日志，提交一次并再次核验。保存替换与恢复的页面截图。最终先保证原图恢复，再报告测试完成。

## 请求模板

`base_fields_data.id` 仍是 **SKU**，不是 Meta 商品数字 ID。只操作下列媒体字段，不发送 URL、标题、价格等其他字段。

```js
const variables = {
  input:{
    catalog_id:catalogId,
    is_showing_canonical_price:false,
    item_data:[{
      base_fields_data:{id:retailerId,uploaded_video_ids:[]},
      extended_fields_data:[
        {field_name:'image_link',field_value:{value_string:newImageUrl}},
        {field_name:'additional_image_link',field_value:{value_list:[]}}
      ],
      item_sub_type:null
    }],
    use_case:'BULK_EDITOR',version:''
  },
  shouldReturnUpdatedProductItems:false
};
// 上方空数组只适用于已读取确认无额外媒体的商品。
// 禁止加入来自商品详情的 uploaded_image_id / additional_uploaded_image_ids。
const request = {
  kind:'graphql',origin:'https://business.facebook.com',
  pageOrigin:'https://business.facebook.com',path:'/api/graphql/',method:'POST',
  friendlyName:'CatalogBulkItemEditorHooksBulkItemUpdateMutation',
  docId:'29601050282817196',variables,timeoutMs:45000
};
```

若超时，记录 `unknown` 后查询状态。`success:false` 或 `FATAL` 时记录具体 SKU、错误、更新数，不当作成功。原始图片源 URL 没变并不证明后台从未收到请求；先核验状态及后续结果，不能立即复制上一条请求重发。更换请求路线需基于已观察到的官网字段逻辑，并使用新日志说明原因。

回读图片 ID 可能因重新抓图而变化；恢复判据是原始 `image_url`、实际图片呈现和非图片业务字段，而不是要求 Meta 生成的图片对象 ID 完全相同。未经读取的字段和多商品批量图片更新不在本轮验收范围内。

AdsPower 1.6.1：新建测试商品主图 URL 替换已真实写入并回读；Meta 图片抓取异步，若官网提示“正在等待重新调取”，仅报告字段保存成功，缩略图完成状态另行核验。不得自动重发 mutation 催促抓图。
