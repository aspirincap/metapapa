# 4 项账户辅助工具

仅保留原 22 项清单的第 19–22 项，编号沿用原清单。

| 原编号 | 功能 | 执行方式 | 边界 |
|---|---|---|---|
| 19 | 账户时区 | `toolbox.py timezone` | IANA 时区转换；夏令时不存在的时间报错，重复时间需指定 fold。修改 Meta 账户时区另走账户操作流程 |
| 20 | 2FA TOTP | `toolbox.py totp`，仅 stdin/stdout | 密钥不写任务文件或命令行；遵守当前工具对认证信息的规则，未授权不生成或提交 |
| 21 | Facebook ID | `facebook_id_public.py` 匿名 GET；`facebook-id.mjs` 为 Chrome 回退；`toolbox.py facebook.id` 做本地语法解析 | 短名优先按 [FBID 查询文档](facebook-id.md)匿名请求主页；无法核实再按授权范围使用 Chrome，区分 Profile ID 与其他对象编号 |
| 22 | 账号/主页检测 | Chrome 打开用户指定目标，读取当前页面 | 返回可访问、需登录、限制等实际观察；不能从默认头像或图片重定向推断封号 |

本地工具仅依赖 Python 3.10+ 标准库；匿名 FBID 网络查询额外使用 curl 7.63+。`toolbox.py doctor` 用于运行环境检查。

## 本地调用

```sh
python3 <skill-dir>/scripts/toolbox.py timezone --input /absolute/job.json --output /absolute/result.json
```

省略 `--input` 时从 stdin 读取 JSON，省略 `--output` 时输出到 stdout；已有输出文件不会被覆盖。TOTP 必须同时省略这两个文件参数。

时区转换输入：

```json
{"datetime":"2026-11-10T12:00:00","from_zone":"Asia/Shanghai","to_zone":"America/Los_Angeles"}
```

Facebook ID 解析输入（示例 ID 不是真实操作目标）：

```json
{"value":"https://www.facebook.com/profile.php?id=123"}
```

解析结果不证明目标的归属、权限或账号状态。账号/主页检测需遵循 `browser-workflow.md`，在正确登录身份下读取实际页面并记录核验时间。
