<div align="center">

[中文](./README.md) · **English**

# 🧭 metapapa

#### Query Meta assets and manage catalogs using your existing Chrome or AdsPower session

[![Version](https://img.shields.io/badge/Version-1.6.1-3B82F6?style=for-the-badge)](https://github.com/aspirincap/metapapa/releases/tag/v1.6.1)
[![Skill](https://img.shields.io/badge/Agent-Skill-8B5CF6?style=for-the-badge)](./metapapa/SKILL.md)
[![Tests](https://img.shields.io/badge/Offline_Tests-111_passed-10B981?style=for-the-badge)](#-development-and-tests)

![Codex](https://img.shields.io/badge/Codex-Tested-10B981?style=flat-square)
![Chrome](https://img.shields.io/badge/Chrome-Existing_Session-4285F4?style=flat-square)
![AdsPower](https://img.shields.io/badge/AdsPower-Chromium_%2B_Local_API_V1-0EA5E9?style=flat-square)

</div>

**Choose a browser → verify identity → query assets → import products → edit fields → read back the result.**

metapapa combines an Agent Skill, Node.js clients, and Python utilities. It uses the selected browser's Facebook session without requiring a separate browser extension, custom MCP server, or OAuth application. Public Facebook profile IDs can be resolved anonymously when page metadata is available.

> Intended for supervised tasks in one selected environment. Core Catalog workflows have been tested; validation varies by operation. Advertising account writes are blocked by default.

---

## 📋 Capabilities

| Capability | What it does | Validation |
|---|---|---|
| 🔌 Onboarding | Choose Chrome or AdsPower, verify the personal account, detect login challenges | Main flows tested |
| 🗂️ Meta assets | Query ad accounts, businesses, Pages, Pixels / Datasets, and catalogs | Selected operations tested |
| 📦 Catalog queries | List catalogs, feeds, products, and product sets; check ownership and pagination | Tested |
| 🛠️ Create and rename | Create a catalog and rename it through Commerce Manager | Tested in AdsPower |
| 📄 CSV / Feed imports | Validate CSV, upload, preview, create a feed, import, and verify | One-product manual feed tested in AdsPower |
| ✏️ Product edits | Update product name, destination URL, and main image URL with readback | Single-product writes tested; image fetching verified separately |
| 🔎 Facebook IDs | Try an anonymous page GET first; use a browser fallback when authorized | Vanity URL routes tested |
| 📊 Reports and utilities | Reporting clients, CSV/JSON output, timezone, TOTP, and numeric ID tools | Coverage varies by operation |

The shared client implements **77 named operations: 47 reads and 30 writes**. **19 write operations are blocked by default.** Catalog and profile-ID clients provide additional dedicated methods. Implementation counts are not production validation counts.

→ [Coverage](./metapapa/references/coverage.md) · [Operation reference](./metapapa/references/api.md)

---

## 📦 Installation

Ask an agent that supports Skills:

```text
Install this Skill: https://github.com/aspirincap/metapapa/tree/main/metapapa
```

Or install into Codex's default Skill directory:

```bash
git clone https://github.com/aspirincap/metapapa.git
cd metapapa
mkdir -p "$HOME/.codex/skills"
# Stop if an installation already exists; compare versions and back it up first.
test ! -e "$HOME/.codex/skills/metapapa" && \
  cp -R metapapa "$HOME/.codex/skills/metapapa"
```

A Skill-only ZIP is available in [Releases](https://github.com/aspirincap/metapapa/releases). Other agents have different installation directories and browser capabilities; compatibility must be checked separately.

### Requirements

| Route | Requirements |
|---|---|
| Local CSV / utilities | Python 3.10+, standard library only |
| Anonymous Facebook ID lookup | Python 3.10+, curl 7.63+ |
| Existing Chrome | Node.js 20+ and an agent browser tool that can access the selected Chrome session; API calls additionally require a documented CDP capability |
| AdsPower | Node.js 22.12+, a running AdsPower app with Local API access, a Chromium profile, and the optional dependency below |

Only AdsPower mode needs:

```bash
cd "$HOME/.codex/skills/metapapa"
npm ci --ignore-scripts --no-audit --no-fund
```

The Chrome and local utility routes do not need this npm dependency.

---

## 🚀 First run

**Chrome**

```text
$metapapa Set up my existing Chrome session.
Help me log in to the Facebook personal account I want to use,
verify its identity, then list catalogs without making changes.
```

**AdsPower**

```text
$metapapa Use my selected AdsPower profile <PROFILE_ID>.
Check the Local API and Facebook login, verify the identity, then list catalogs.
Keep advertising account writes blocked.
```

Provide the AdsPower API key through secure task input, runner stdin, or the `METAPAPA_ADSPOWER_API_KEY` environment variable. Do not put it in repository files, command-line arguments, task files, or logs. Enter passwords and verification codes on the official website; account unlocks remain a user action.

→ [Onboarding](./metapapa/references/onboarding.md) · [Chrome](./metapapa/references/browser-workflow.md) · [AdsPower](./metapapa/references/adspower.md)

---

## ✨ Example requests

### Catalogs and imports

```text
List the catalogs available to this account, including their business and product count.

List all products in the feed I select, and report whether pagination is complete.

Validate this CSV, create a manual feed in the selected catalog,
then import it and verify the success and error counts.
```

### Product edits

```text
Change the destination URL of SKU EXAMPLE-001 to https://example.com/new-product,
then read it back.

Rename SKU EXAMPLE-001 to “Example Product V2”, keeping its SKU and other fields.

Replace the main image using the URL I provide. Report field persistence
and Meta's image-fetch status separately.
```

The client verifies the catalog, SKU, Meta product ID, and feed before planning a write. It skips values that already match and reconciles uncertain results before any further submission.

**Manual edits to feed products may be overwritten by a later feed upload.** Editing a product does not update the original CSV or feed source.

### Queries and local utilities

```text
Resolve this public Facebook Page's ID. Try without logging in or opening Chrome first.

List accessible advertising accounts without modifying them, and export JSON.

Check this product CSV for duplicate SKUs, missing fields, and invalid URLs.
```

---

## ✅ Validation and limits

Live validation as of **November 10, 2026** includes:

- Selected Chrome asset and Catalog reads, product pagination, and single-product URL / main-image URL / name updates and restores.
- AdsPower connection, identity checks, selected asset reads, catalog creation and renaming, and a one-row CSV import into a new manual feed.
- AdsPower product name, URL, and main-image URL writes with matching readbacks. The import reported one added/updated item, zero failures, and zero issues.
- The latest AdsPower image test confirmed **image URL persistence**, while **Meta's asynchronous image fetch was still pending** at the last UI check.
- **87 JavaScript and 24 Python offline tests passed.**

Batch product mutations, existing-feed updates or full replacement, scheduled imports, classified products, complex media, multiple concurrent profiles, and long-running unattended recovery have not been fully validated. AdsPower supports **Chromium + Local API V1**; Firefox and V2 are not adapted. Its runner mainly exposes general reads and dedicated Catalog writes, not all Meta write workflows.

Meta's website protocols and `doc_id` values can change. Login challenges, permission failures, rate limits, and schema changes require checking the current official page.

→ [Validation scope](./metapapa/references/coverage.md) · [Structured summary](./metapapa/references/verification.json) · [Recovery](./metapapa/references/recovery.md)

---

## 🧩 Repository layout

```text
metapapa/
├── README.md
├── README.en.md
├── metapapa/
│   ├── SKILL.md
│   ├── agents/openai.yaml
│   ├── references/          # Capabilities, protocols, browser and recovery guides
│   ├── scripts/             # Meta clients, AdsPower, CSV and local utilities
│   └── package-lock.json    # Optional AdsPower dependency
└── tests/metapapa/           # Offline regression tests with simulated data
```

## 🧪 Development and tests

Run from the repository root:

```bash
npm test
npm run test:csv
node metapapa/scripts/inspect.mjs
python3 metapapa/scripts/toolbox.py doctor < /dev/null
```

Tests use simulated sessions and data. They do not log into Facebook or change real advertising accounts, and they do not require an AdsPower key.

## 🔗 Documentation

[Skill entry](./metapapa/SKILL.md) · [Catalog / CSV](./metapapa/references/catalog.md) · [Product URLs](./metapapa/references/catalog-product-urls.md) · [Images](./metapapa/references/catalog-product-images.md) · [Names](./metapapa/references/catalog-product-names.md) · [Facebook IDs](./metapapa/references/facebook-id.md)

The detailed operating guides are currently in Chinese. For reproducible bugs or suggestions, open an [issue](https://github.com/aspirincap/metapapa/issues) after removing account identifiers and credentials from any logs.
