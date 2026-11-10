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

从 **选择环境 → 核对个号 → 查询资产 → 导入商品 → 修改字段 → 回读验证**，把重复操作交给 Agent。

metapapa 是一个包含操作指引、Node.js 客户端和 Python 本地工具的 Skill。无需安装独立浏览器扩展，也无需自建 MCP 服务或申请 OAuth 应用。Meta 操作沿用所选浏览器的当前会话；公开主页 FBID 可先匿名查询。

> 当前适合有人跟进的单环境任务。Catalog 核心流程已经实测，其他能力按操作区分验收状态。广告账户写入默认禁止。

---

## 📋 能力一览

| 能力 | 可以做什么 | 当前状态 |
|---|---|---|
| 🔌 登录与环境 | 引导 Chrome / AdsPower 登录，核对个人身份，检测登录挑战 | 主要流程已实测 |
| 🗂️ Meta 资产查询 | 查询广告账户、BM、主页、Pixel / Dataset、Catalog 等 | 部分操作已实测，详见接口清单 |
| 📦 Catalog 查询 | 列目录、Feed、商品和商品集，核对分页与归属 | 已实测 |
| 🛠️ 创建与改名 | 官网创建目录、修改目录名称 | AdsPower 已实测 |
| 📄 CSV / Feed 导入 | 预检 CSV、上传预览、新建 Feed、导入并核对结果 | AdsPower 单商品手动 Feed 已实测 |
| ✏️ 商品编辑 | 修改商品名称、落地页 URL、主图 URL，并逐项回读 | 单商品已实测；图片抓取另行核验 |
| 🔎 主页 FBID | 匿名 GET 解析公开主页 ID，按授权范围回退浏览器 | 短名路线已实测 |
| 📊 报表与辅助 | 广告查询/报表客户端、本地 CSV/JSON 整理、时区、TOTP、ID 工具 | 各项实测状态不同 |

通用客户端有 **77 个命名操作（47 读、30 写）**，其中 **19 个写操作默认被拦截**。Catalog 和 FBID 另有专用模块。实现数量不等于已通过生产验证的数量。

→ [完整覆盖范围](./metapapa/references/coverage.md) · [功能与接口清单](./metapapa/references/api.md)

---

## 📦 安装方式

在支持 Skill 的 Agent 中直接说：

```text
帮我安装这个 Skill：https://github.com/aspirincap/metapapa/tree/main/metapapa
```

或在 Codex 的默认 Skill 目录手动安装：

```bash
git clone https://github.com/aspirincap/metapapa.git
cd metapapa
mkdir -p "$HOME/.codex/skills"
# 已有同名目录时停止，先比较版本并备份。
test ! -e "$HOME/.codex/skills/metapapa" && \
  cp -R metapapa "$HOME/.codex/skills/metapapa"
```

也可以从 [Releases](https://github.com/aspirincap/metapapa/releases) 下载仅含 Skill 的 ZIP，解压到你的 Skill 目录。其他 Agent 使用各自的安装目录；浏览器能力是否可用需要单独核对。

### 运行依赖

| 路线 | 需要什么 |
|---|---|
| 本地 CSV / 账户辅助 | Python 3.10+，使用标准库 |
| 匿名 FBID | Python 3.10+、curl 7.63+ |
| 现有 Chrome | Node.js 20+；Agent 提供可操作当前 Chrome 的浏览器工具，接口路线还需文档化 CDP 能力 |
| AdsPower | Node.js 22.12+、已启动的 AdsPower、Local API 权限、Chromium 环境，以及下方可选依赖 |

只有使用 AdsPower 时需要：

```bash
cd "$HOME/.codex/skills/metapapa"
npm ci --ignore-scripts --no-audit --no-fund
```

普通 Chrome 和本地工具不需要安装这项 npm 依赖。

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

AdsPower API Key 通过任务内安全输入、runner 标准输入或 `METAPAPA_ADSPOWER_API_KEY` 环境变量提供，不写入仓库、命令行参数、任务文件或日志。密码、验证码和账号解锁在官网完成。

→ [Onboarding](./metapapa/references/onboarding.md) · [Chrome 调用方式](./metapapa/references/browser-workflow.md) · [AdsPower 适配](./metapapa/references/adspower.md)

---

## ✨ 怎么触发

### 📦 目录和商品

```text
列出当前个号能访问的 Catalog，标明所属 BM 和商品数。

查看我指定目录中的 Feed，再列出这个 Feed 的全部商品，说明分页是否完整。

检查这份 CSV，在指定目录中新建一个手动 Feed，导入后核对成功数和错误。
```

### ✏️ 商品编辑

```text
把指定目录中 SKU EXAMPLE-001 的链接改为 https://example.com/new-product，写入后回读。

把 SKU EXAMPLE-001 改名为“示例商品新版”，保留 SKU 和其他字段。

用我提供的图片 URL 替换主图，分别报告 URL 是否保存、Meta 是否已经抓取新图片。
```

商品编辑先核对目录、SKU、Meta 商品 ID 和 Feed，再生成计划、执行并回读。已一致的字段跳过；结果未知时先对账，不重复提交。

**来自 Feed 的手动编辑可能被下一次上传覆盖。** 商品字段修改不等于原 CSV 或 Feed 源文件已更新。

### 🔎 查询与本地处理

```text
查询这个 Facebook 公共主页的 FBID，先尝试不登录、不打开 Chrome。

只读列出当前可访问的广告账户，并导出 JSON。

预检这份商品 CSV，列出重复 SKU、缺失字段和无效 URL。
```

---

## ✅ 已验证到什么程度

真实环境验收截至 **2026-11-10**：

- Chrome：资产和 Catalog 部分只读查询、商品分页、单商品 URL/主图 URL/名称修改及恢复。
- AdsPower：环境连接与身份核对、部分资产查询、目录创建与改名、1 行 CSV 的新 Feed 导入。
- AdsPower：商品名称、URL、主图 URL 写入和回读通过；导入新增/更新 1、失败 0、问题 0。
- 最新 AdsPower 图片测试中，**URL 字段已保存，Meta 异步图片抓取仍待完成**。两者不混为一个成功状态。
- 离线回归：**87 项 JavaScript + 24 项 Python 测试通过**。

### 尚未完整支持

批量商品写入、原 Feed 更新/全量替换、计划导入、分类商品和复杂媒体、多环境并发、长时无人值守恢复未完整验收。AdsPower 当前适配 **Chromium + Local API V1**，Firefox 与 V2 未适配；runner 主要提供通用读取和 Catalog 专用写入，不能视作全部 Meta 模块已迁移。

Meta 网页接口及 `doc_id` 可能变化。遇到登录挑战、权限不足、限流或结构变化时，需要核对当前官方页面。

→ [验收范围](./metapapa/references/coverage.md) · [结构化验证摘要](./metapapa/references/verification.json) · [中断恢复](./metapapa/references/recovery.md)

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

测试使用模拟会话和数据，不登录真实 Facebook，也不会修改真实广告账户。普通离线测试不需要 AdsPower Key。

## 🔗 文档导航

[Skill 入口](./metapapa/SKILL.md) · [Catalog 与 CSV](./metapapa/references/catalog.md) · [商品链接](./metapapa/references/catalog-product-urls.md) · [商品主图](./metapapa/references/catalog-product-images.md) · [商品改名](./metapapa/references/catalog-product-names.md) · [FBID](./metapapa/references/facebook-id.md)

## 🌟 关于

面向日常 Meta 资产查询与商品目录维护的实用 Skill。欢迎在 [Issues](https://github.com/aspirincap/metapapa/issues) 反馈可复现问题；请移除账号标识和认证信息后再提供日志。
