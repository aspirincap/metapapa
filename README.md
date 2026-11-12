<div align="center">

**中文** · [English](./README.en.md)

# 🧭 metapapa

#### 用自然语言查询 Meta 资产、管理 Catalog，沿用你的 Chrome 或 AdsPower 登录会话

[![Version](https://img.shields.io/badge/Version-1.6.1-3B82F6?style=for-the-badge)](https://github.com/aspirincap/metapapa/releases/tag/v1.6.1)
[![Skill](https://img.shields.io/badge/Agent-Skill-8B5CF6?style=for-the-badge)](./metapapa/SKILL.md)
[![Tests](https://img.shields.io/badge/Offline_Tests-111_passed-10B981?style=for-the-badge)](#-开发与验证)

![Codex](https://img.shields.io/badge/Codex-Tested-10B981?style=flat-square)
![Chrome](https://img.shields.io/badge/Chrome-Existing_Session-4285F4?style=flat-square)
![AdsPower](https://img.shields.io/badge/AdsPower-Chromium_%2B_Local_API_V1-0EA5E9?style=flat-square)

</div>

选环境、核对个号、查资产、导入商品、修改字段，再回读结果。这些重复操作可以交给 Agent 处理。

metapapa 是一个 Skill，里面有操作指引、Node.js 客户端和 Python 本地工具。它沿用你选定浏览器中的当前会话，不需要额外安装浏览器扩展、搭建 MCP 服务或申请 OAuth 应用。查询公开主页 FBID 时，可以先尝试匿名查询。

> 以下能力已在 Codex 中实测，浏览器操作使用单个选定环境。广告账户写入默认禁止。

---

## 📋 能力一览

| 能力 | 已实测操作 | 实测环境 |
|---|---|---|
| 🔌 身份核对 | 读取当前 Facebook 个号身份 | Chrome、AdsPower |
| 🔌 AdsPower 连接 | 启动或复用环境，核对页面与接口身份，检测账号锁定，断开后保留窗口 | Chromium + Local API V1 |
| 🗂️ 资产列表 | 列出广告账户和 BM | Chrome、AdsPower |
| 🗂️ 资产详情 | 查询广告账户详情与限额、BM 详情、主页列表、Pixel 列表 | Chrome |
| 📦 Catalog 查询 | 列出目录、Feed 和商品，按分页读取商品 | Chrome、AdsPower |
| 📦 Catalog 详情 | 查询目录详情、Feed 详情和商品集列表 | Chrome |
| 🛠️ 创建与改名 | 在官网创建 commerce 目录、修改目录名称 | AdsPower |
| 📄 CSV / Feed 导入 | 预检 1 行商品 CSV、上传预览、新建手动 Feed、导入并核对结果 | AdsPower |
| ✏️ 商品编辑 | 修改单个商品的名称、落地页 URL、主图 URL，并逐项回读；Chrome 还验证了恢复原值 | Chrome、AdsPower |
| 🔎 主页 FBID | 从短名主页链接查询 FBID：匿名 curl GET 成功 1 例，登录会话查询成功 2 例 | 无浏览器、Chrome |

→ [实测记录](./metapapa/references/verification.json)

---

## 📦 安装方式

在支持 Skill 的 Agent 中，可以直接说：

```text
帮我安装这个 Skill：https://github.com/aspirincap/metapapa/tree/main/metapapa
```

也可以手动安装到 Codex 的默认 Skill 目录：

```bash
git clone https://github.com/aspirincap/metapapa.git
cd metapapa
mkdir -p "$HOME/.codex/skills"
# 已有同名目录时停止，先比较版本并备份。
test ! -e "$HOME/.codex/skills/metapapa" && \
  cp -R metapapa "$HOME/.codex/skills/metapapa"
```

如果不想 clone 仓库，可以从 [Releases](https://github.com/aspirincap/metapapa/releases) 下载仅含 Skill 的 ZIP，解压到 Skill 目录。

### 运行依赖

| 路线 | 需要什么 |
|---|---|
| 本地 CSV 预检 | Python 3.10+，使用标准库 |
| 匿名 FBID | Python 3.10+、curl 7.63+ |
| 现有 Chrome | Node.js 20+；Agent 提供可操作当前 Chrome 的浏览器工具，接口路线还需文档化 CDP 能力 |
| AdsPower | Node.js 22.12+、已启动的 AdsPower、Local API 权限、Chromium 环境，以及下方可选依赖 |

使用 AdsPower 时，还需要安装以下依赖：

```bash
cd "$HOME/.codex/skills/metapapa"
npm ci --ignore-scripts --no-audit --no-fund
```

普通 Chrome 模式和本地工具都不需要这项 npm 依赖。

---

## 🚀 第一次使用

**Chrome 模式**

```text
$metapapa 帮我初始化，使用现有 Chrome。
引导我登录要使用的 Facebook 个号，核对身份后只读列出 Catalog。
```

**AdsPower 模式**

```text
$metapapa 使用我指定的 AdsPower 环境 <环境ID>。
先检查 Local API 和 Facebook 登录状态，核对个号后列出 Catalog。
禁止广告账户写入。
```

AdsPower API Key 可以通过任务内安全输入、runner 标准输入或 `METAPAPA_ADSPOWER_API_KEY` 环境变量提供。不要把 Key 写进仓库、命令行参数、任务文件或日志。输入密码、填写验证码和解锁账号都在官网完成。

→ [Onboarding](./metapapa/references/onboarding.md) · [Chrome 调用方式](./metapapa/references/browser-workflow.md) · [AdsPower 适配](./metapapa/references/adspower.md)

---

## ✨ 怎么触发

### 📦 目录和商品

```text
列出当前个号能访问的 Catalog，标明所属 BM 和商品数。

查看我指定目录中的 Feed，再列出这个 Feed 的全部商品，说明分页是否完整。

检查这份单商品 CSV，在指定目录中新建一个手动 Feed，导入后核对成功数和错误。
```

### ✏️ 商品编辑

```text
把指定目录中 SKU EXAMPLE-001 的链接改为 https://example.com/new-product，写入后回读。

把 SKU EXAMPLE-001 改名为“示例商品新版”，保留 SKU 和其他字段。

把 SKU EXAMPLE-001 的主图 URL 改为我提供的链接，写入后回读该字段。
```

编辑商品时，先核对目录、SKU、Meta 商品 ID 和 Feed，再生成修改计划、执行并回读结果。字段已经符合目标值，就跳过；无法确认结果时，先核对当前数据，不重复提交。

**手动编辑 Feed 中的商品后，下一次上传可能覆盖这些修改。** 商品字段改了，不代表原 CSV 或 Feed 源文件也已更新。

### 🔎 查询与本地处理

```text
查询这个 Facebook 公共主页的 FBID，先尝试不登录、不打开 Chrome。

只读列出当前可访问的广告账户。

预检这份商品 CSV，列出重复 SKU、缺失字段和无效 URL。
```

---

## ✅ 实测结果

截至 **2026-11-10**，已在真实环境中验证以下操作：

- Chrome：单商品名称、落地页 URL、主图 URL 修改并恢复原值，回读与目标一致。
- AdsPower：创建 1 个 commerce 目录并改名；上传 1 行 CSV，新建手动 Feed 并完成导入，新增/更新 **1**、移除 **0**、失败 **0**、问题 **0**。
- AdsPower：单商品名称、落地页 URL、主图 URL 分别写入成功，回读与目标一致，其余已读取字段保持不变。
- FBID：匿名短名查询成功 1 例，结果与此前 Chrome 查询一致；Chrome 短名查询成功 2 例。

另有 **87 项 JavaScript + 24 项 Python 离线测试通过**，使用模拟会话和数据。

→ [结构化验证摘要](./metapapa/references/verification.json)

---

## 🧩 项目结构

```text
metapapa/
├── README.md
├── README.en.md
├── metapapa/
│   ├── SKILL.md
│   ├── agents/openai.yaml
│   ├── references/          # 能力、接口、浏览器与恢复指引
│   ├── scripts/             # Meta 客户端、AdsPower、CSV、本地工具
│   └── package-lock.json    # AdsPower 可选依赖
└── tests/metapapa/           # 使用模拟数据的离线回归
```

## 🧪 开发与验证

在仓库根目录运行：

```bash
npm test
npm run test:csv
node metapapa/scripts/inspect.mjs
python3 metapapa/scripts/toolbox.py doctor < /dev/null
```

测试使用模拟会话和数据，不会登录真实 Facebook，也不会修改真实广告账户。运行这些离线测试不需要 AdsPower Key。

## 🔗 文档导航

[Skill 入口](./metapapa/SKILL.md) · [Catalog 与 CSV](./metapapa/references/catalog.md) · [商品链接](./metapapa/references/catalog-product-urls.md) · [商品主图](./metapapa/references/catalog-product-images.md) · [商品改名](./metapapa/references/catalog-product-names.md) · [FBID](./metapapa/references/facebook-id.md)

## 🌟 关于

遇到可复现的问题，欢迎到 [Issues](https://github.com/aspirincap/metapapa/issues) 反馈。附日志前，请先移除账号标识和认证信息。
