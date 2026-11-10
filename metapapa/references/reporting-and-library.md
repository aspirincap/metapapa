# 报告、评论与广告资料库

## 广告报告

用 `client.paginate('ads.insights.query', ...)` 取得明确日期与层级的数据。日期使用账户当地时区，记录账户时区，不按电脑时区擅自换日。空数据、失败与零花费分开；不同币种不合计为一个金额。

```js
const reporting = await import('file://'+SKILL_DIR+'/scripts/report.mjs');
await reporting.exportSnapshot(TASK_DIR+'/snapshot.json', result);
await reporting.exportReport({path:TASK_DIR+'/report.md', snapshot:result,
  context:{since,until,level,accountTimezone}});
const csv = reporting.rowsToCSV(result.data, ['account_id','campaign_id','spend','impressions','clicks']);
// 用当前工具的本地文件 API 保存 csv；不是上传到第三方。
```

`report.mjs` 对金额按两位小数精确相加，不支持的精度会报错而不默默舍入。不同币种独立汇总。不要混入重叠日期、重复对象或不同层级；reach、actions、归因结果不盲目相加。CSV 对公式起始字符进行转义；Facebook ID 原始字符串保存在 JSON，Excel 导入 CSV 时将 ID 列设为文本。

## 评论任务

1. `comments.list` 按帖子逐页查询。Facebook post/comment ID 可能是 `数字_数字`，不可强转 number。
2. 本地 `python3 <skill-dir>/scripts/comments.py --input /absolute/job.json --output /absolute/preview.json` 输入 comments、keywords、exclude_author_ids、action，输出命中 ID 和关键词，`executed:false`。可省略文件参数改用 stdin/stdout，已有输出文件不会覆盖。关键词是普通字符串，不执行用户给的正则或脚本。
3. 用户已明确给出规则、帖子范围与动作时按授权执行；只有“分析评论”不代表可删除/隐藏。
4. 单条 `comments.hide` / `comments.remove` 使用 plan/execute；页面切换主页身份时核对 pageId。每条写入后读评论状态/实际页面，记录成功或待核验。
5. 不安装常驻监控、自动隐藏进程。批量仅在活跃任务中运行，可通过日志恢复。

## 广告资料库

用现有 Chrome 打开 Facebook Ad Library，设定用户要求的国家、状态、关键词或主页。读取当前可见广告卡片，结构化记录 library ID、广告主/主页、正文、开始日期、状态、地区、落地页和媒体类型。输出 CSV/JSON/Markdown，并记录查询条件、抓取时间及是否只覆盖当前加载项。

素材下载优先使用当前浏览器工具广告卡片对应的 `downloadMedia()` 或 `pageAssets` 能力，先阅读能力文档，媒体链接必须来自实际观察到的页面。卡片有多版本时对应明确素材，保留来源关联。不枚举猜测媒体 URL。遇到仅 blob/MSE 或无可下载素材，说明限制并保留截图/来源；不能把预览截图说成完整视频。

页面临时表格/排序增强可在当前任务的结果文件完成，不默认注入或安装常驻按钮。当前版本交付的是 Skill 操作流程，广告库素材下载没有在本轮逐素材实测。
