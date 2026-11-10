# Catalog 与 CSV Feed

## 当前可执行路线

- 目录列表/详情、商品列表/详情、商品集列表/详情：共享客户端的 `catalogs.*`。其中目录、商品列表及分页、商品集列表已做本机只读实测。
- Feed 列表、详情、上传、预览、新增独立 Feed、导入及结果核验：`scripts/catalog.mjs`。
- 商品 URL 修改：优先用 `catalog-product-urls.md` 的 `scripts/catalog-products.mjs`，批量网页请求 + SKU/Meta ID/Feed 核验 + 逐项回读。已通过单商品 URL 往返写入与回读实测，多商品 mutation 待验证；当前仅适配未分类、无伙伴集成的普通商品，其他情况回到官网编辑器。
- 商品主图 URL 替换：优先调用 `scripts/catalog-products.mjs` 的 `createCatalogProductImageClient`，见 `catalog-product-images.md`。支持计划、接口提交、回读、原图备份与恢复计划；单主图、无其他媒体的协议已完成真实往返验证，不把既有商品图片 ID 当作上传句柄。
- 商品改名：优先调用同一模块的 `createCatalogProductNameClient`，见 `catalog-product-names.md`。通过 title 写入、name / Name 双重回读；支持原名备份与恢复计划，已完成真实往返验证，不改变 SKU。
- 目录创建/改名/删除、商品其他字段编辑/删除、商品集编辑、原 Feed 更新/替换、URL Feed、计划、关联资产权限：`ui-workflows.md` 的官方 Commerce Manager 路线。目录创建及改名已通过 AdsPower 官网 UI 实测；其他扩展写入仍未获得生产验收。

## CSV 预检

```sh
python3 <skill-dir>/scripts/prepare_csv.py /absolute/input.csv --out-dir /absolute/task/catalog
```

必填列 `id,title,description,availability,condition,link,image_link,brand,price`；保留额外列、字符串 SKU、引号、换行和 UTF-8 BOM，不覆盖源文件。价格格式如 `19.99 USD`，不虚构或换算价格。重复 SKU、缺列、缺值、行宽错误和 URL 语法错误会阻止上传。多个币种不会被强行转换，但必须明确 Feed 的默认币种。图片检查仅验证 URL 语法，Meta 预览与导入仍可能发现无法抓图等问题。

产物 `prepared.csv` + `manifest.json`。原文件有 “# Required / # Optional” 模板说明行时仅在上传副本去掉。空文件/零商品失败。10 MiB 以上文件使用浏览器当前支持的官方文件选择上传流程，不把整份 CSV 送入对话；大文件客户端分块尚未实现。

## 新增独立 Feed

打开**本次发现的**目标目录主页，核对 URL 中目录与 BM。当前身份必须和资产发现步骤一致。

```js
const {createCatalogClient} = await import('file://'+SKILL_DIR+'/scripts/catalog.mjs');
const catalog = await createCatalogClient({
  cdp, catalogId, businessId, expectedActorId,
  manifestPath:TASK_DIR+'/catalog/manifest.json',
  journalPath:TASK_DIR+'/catalog/import-journal.json'
});
await catalog.inspectSession();
const before = await catalog.listFeeds();
// 用户已授权此 CSV 上传到此目录后，才能调用 upload。
await catalog.upload();
const preview = await catalog.preview();
// preview.ok 必须为 true；行问题、SKU 冲突、缺列或重复均阻止创建。
await catalog.createFeed({name:feedName, defaultCurrency:'USD'});
await catalog.startImport();
const status = await catalog.checkResult();
```

每一步是独立调用，可观察结果后再继续。默认新 Feed，`schedule:null`，`update_only:false`。**此参数不代表可对既有 Feed 做安全全量替换**；既有源更新需要单独核对 SKU 所属源、缺失 SKU 语义、更新/替换范围。

`checkResult` 需要最新上传 ID 与本次 session ID 相同、数量吻合且有更新时间，返回 `count_matched_verify_ui` 才进入界面核对。页面确认同一 Feed、商品数与成功状态，保存截图或明确可审阅的 UI 证据文件后：

```js
await catalog.recordVerified({feedId, productCount, uiStatus:'All good', evidencePath});
```

处理中的状态、数量不符、错误或部分成功均不得报完成。总目录 70 条不等于本 Feed 20 条，核验必须限定本批 Feed。`listFeeds()` 是当前 selector 返回的列表，不保证任意大型目录的完整分页。

## 中断恢复

```js
const restored = await createCatalogClient({
  cdp, catalogId, businessId, expectedActorId,
  journalPath, resume:true
});
await restored.inspectSession();
await restored.listFeeds();
// 有已确认 feed_id 和 upload_session_id 时可直接 checkResult。
await restored.checkResult();
```

恢复模式只用于读和结果核验，不自动重复上传、建 Feed 或导入。若 createFeed/startImport 请求失联、日志缺少返回 ID，根据日志名称/时间在数据源列表核对，再人工确认已有对象。上传 handle 只留内存，不能从日志恢复。无法确定时停在“结果待核验”，保留日志。

`catalog-operations.json` 是已有操作定义快照。2026-11-10 新模块已在 AdsPower 真实完成 1 件测试商品的上传、预览、新建 Feed、导入与核验：新增/更新 1、移除 0、失败 0、问题 0，最新 upload ID 与本次一致。原 Feed 更新/替换及多商品导入仍待本模块实际验收。遇到 doc_id 失效，观察官方页面产生的请求，审核后更新快照；禁止轮试猜测 ID。

## AdsPower 目录创建与改名（1.6.1 实测）

- Commerce 资产页的“目录”区加号进入创建；不要选择“添加帐户”（店铺）。实际创建页为 `/products/catalogs/new/?business_id=...`。
- 实物商品还要选择二级“线上商品”。确认选择标签和名称最终值；**设置页“下一页”已经创建目录**，之后权限/商品页不是首次提交点。提交前写入任务日志，之后先回读 `catalogs.list` 的新 ID、名称和 `vertical:commerce`。
- 本次测试关闭合作伙伴同步、自动人员授权和所有数据集连接，只保留创建者访问。实际任务按用户明确的权限范围操作，不把创建目录理解为授权关联广告账户。
- 新目录可选“稍后添加商品”，再使用上方 Feed 客户端导入。
- 目录改名入口为设置的“目录”标签；当前路径 `/commerce/catalogs/{id}/settings/products/`。保存后用 `catalogs.get` 回读；勿把此操作与商品 title 修改混淆。
- 输入助手返回 `value_verified:true` 仅表示表单值吻合，保存后仍需服务端回读。状态未知先重连核验，不重放创建。
- 主图 URL 更新成功后，官网可能仍显示“已过期 / 图片网址已更改。正在等待重新调取。”。报告“字段已写入，抓图处理中”，只读刷新检查；不能为刷新缩略图重复提交写入。
