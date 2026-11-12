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

> The capabilities below were tested in Codex, with browser operations using one selected environment. Advertising account writes are blocked by default.

---

## 📋 Capabilities

| Capability | Live-tested operations | Test environment |
|---|---|---|
| 🔌 Identity checks | Read the current Facebook personal account identity | Chrome, AdsPower |
| 🔌 AdsPower connection | Start or reuse a profile, match page and API identities, detect a locked account, and disconnect while leaving the browser open | Chromium + Local API V1 |
| 🗂️ Asset lists | List advertising accounts and businesses | Chrome, AdsPower |
| 🗂️ Asset details | Read advertising account details and spend caps, business details, Page lists, and Pixel lists | Chrome |
| 📦 Catalog queries | List catalogs, feeds, and products; paginate through products | Chrome, AdsPower |
| 📦 Catalog details | Read catalog details, feed details, and product set lists | Chrome |
| 🛠️ Create and rename | Create a commerce catalog and rename it through Commerce Manager | AdsPower |
| 📄 CSV / Feed imports | Validate a one-row product CSV, upload and preview it, create a manual feed, import, and verify | AdsPower |
| ✏️ Product edits | Update one product's name, destination URL, and main image URL with readback; restoring original values was also tested in Chrome | Chrome, AdsPower |
| 🔎 Facebook IDs | Resolve vanity URLs: one successful anonymous curl GET lookup and two successful logged-in lookups | No browser, Chrome |

→ [Test record](./metapapa/references/verification.json)

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

A Skill-only ZIP is available in [Releases](https://github.com/aspirincap/metapapa/releases).

### Requirements

| Route | Requirements |
|---|---|
| Local CSV validation | Python 3.10+, standard library only |
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

Validate this one-product CSV, create a manual feed in the selected catalog,
then import it and verify the success and error counts.
```

### Product edits

```text
Change the destination URL of SKU EXAMPLE-001 to https://example.com/new-product,
then read it back.

Rename SKU EXAMPLE-001 to “Example Product V2”, keeping its SKU and other fields.

Set the main image URL of SKU EXAMPLE-001 to the link I provide,
then read back that field.
```

The client verifies the catalog, SKU, Meta product ID, and feed before planning a write. It skips values that already match and reconciles uncertain results before any further submission.

**Manual edits to feed products may be overwritten by a later feed upload.** Editing a product does not update the original CSV or feed source.

### Queries and local utilities

```text
Resolve this public Facebook Page's ID. Try without logging in or opening Chrome first.

List accessible advertising accounts without modifying them.

Check this product CSV for duplicate SKUs, missing fields, and invalid URLs.
```

---

## ✅ Test results

Live validation as of **November 10, 2026** includes:

- Chrome: one product's name, destination URL, and main image URL were changed and restored, with matching readbacks.
- AdsPower: one commerce catalog was created and renamed. A one-row CSV was uploaded and imported into a new manual feed, reporting **1** added/updated item, **0** removed, **0** failed, and **0** issues.
- AdsPower: one product's name, destination URL, and main image URL were each written successfully. Readbacks matched the requested values, and other fetched fields remained unchanged.
- Facebook IDs: one anonymous vanity URL lookup matched the earlier Chrome result; two logged-in Chrome vanity URL lookups succeeded.

Separately, **87 JavaScript and 24 Python offline tests passed**, using simulated sessions and data.

→ [Structured test summary](./metapapa/references/verification.json)

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
