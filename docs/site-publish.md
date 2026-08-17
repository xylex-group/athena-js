# Dual-publish: package docs → apps/docs

This document describes how Athena JS documentation is published from the SDK
package into the monorepo product docs site with as little manual dual-writing
as possible.

## Problem

Two trees used to drift independently:

| Tree | Audience | Format |
| --- | --- | --- |
| `packages/athena-js/docs/**` | SDK / package consumers, agents, local repo | Markdown (and some MDX) |
| `apps/docs/content/docs/sdks/athena-js/**` | Public Fumadocs site (`/docs/sdks/athena-js`) | MDX + frontmatter + `meta.json` |

Hand-copying every change into the site is error-prone. Auto-copying **every**
package file is also wrong: ADRs, release reports, and agent prompt packs are
not product navigation.

## Solution

**Curated dual-publish:**

1. Package docs remain the **narrative source of truth**.
2. A **manifest allowlist** decides what the public site receives.
3. A generator rewrites package Markdown into Fumadocs MDX (frontmatter, links,
   banners, sidebar `meta.json`).
4. Dev / postinstall / build run the generator; CI can `--check` for drift.

```text
packages/athena-js/docs/**
  + site-publish.manifest.json
           │
           │  apps/docs/scripts/sync-athena-js-docs.mts
           │  - strip / inject frontmatter
           │  - rewrite relative links → /docs/sdks/athena-js/...
           │  - inject "do not edit" banner
           │  - write meta.json from nav
           ▼
apps/docs/content/docs/sdks/athena-js/**
           │
           ▼
meta:generate → search → llms → next build
```

Same operational style as existing generators:

- OpenAPI → `content/docs/reference/**`
- `docs:from-code` → `content/docs/reference/generated/**`
- **`docs:sync-athena-js`** → `content/docs/sdks/athena-js/**`

## Files involved

| Path | Role |
| --- | --- |
| `packages/athena-js/docs/**` | Source content you edit |
| `packages/athena-js/docs/site-publish.manifest.json` | Allowlist of pages, titles, nav, site-owned paths |
| `apps/docs/scripts/sync-athena-js-docs.mts` | Generator (write + `--check`) |
| `apps/docs/scripts/__tests__/sync-athena-js-docs.test.mts` | Unit tests for rewrite / frontmatter |
| `apps/docs/content/docs/sdks/athena-js/**` | **Generated** product pages (bannered) |
| `apps/docs/package.json` | Scripts + hooks in `postinstall` / `dev` / `build:next` |
| `packages/athena-js/package.json` | Convenience `docs:site:sync` / `docs:site:check` |

## Manifest shape

`site-publish.manifest.json` controls publishing:

| Field | Meaning |
| --- | --- |
| `pages[]` | Each published page: `source` (under package docs), `out` (under site tree), `title`, `description` |
| `nav` | Root `meta.json` `pages` array (Fumadocs sidebar, including section dividers and `"...auth"`) |
| `authNav` | Auth folder `meta.json` pages |
| `siteOwned` | Site-only recipe files the generator **never overwrites** (e.g. `filtering.mdx`, `mutations.mdx`) |
| `siteBasePath` | Prefix for rewritten links (`/docs/sdks/athena-js`) |

### What is published (allowlist)

Consumer guides: getting started, Next.js, API reference, complete method
reference, migration, storage, types, generator, CLI, request headers, auth
domain pages, session bridge/forwarding, etc.

### What stays package-only (unless you add them to the manifest)

- `docs/adr/**` (linked to GitHub when referenced from a published page)
- `client-v3-consolidation-report.md`
- `client-v3-release-readiness-report.md`
- `generator-codex-handoff-prompt-pack.md`
- `storage/r2-and-backup-impact-report.md`
- This file (`site-publish.md`) — maintainers only

### Site-owned recipes

Pages listed under `siteOwned` are hand-maintained on the site (query cookbooks,
snippet catalogs, etc.). They appear in `nav` so the sidebar stays complete, but
the generator will not replace their content.

## Commands

From the monorepo:

```bash
# Write generated site MDX from package docs
pnpm --dir apps/docs docs:sync-athena-js

# Fail if site MDX drifted (CI)
pnpm --dir apps/docs docs:sync-athena-js:check
```

From the package:

```bash
pnpm --dir packages/athena-js docs:site:sync
pnpm --dir packages/athena-js docs:site:check
```

Autonomous hooks (already wired in `apps/docs`):

| Hook | Includes sync? |
| --- | --- |
| `postinstall` | Yes |
| `dev` | Yes |
| `build:next` | Yes (before meta / search / llms / next build) |

Order in the docs app pipeline:

```text
openapi prepare
  → docs:from-code
  → docs:sync-athena-js
  → generate-doc-metadata
  → search / llms
  → next build
```

## Day-to-day workflow

### Edit consumer docs

1. Change Markdown/MDX under `packages/athena-js/docs/`.
2. Run `pnpm --dir packages/athena-js docs:site:sync` (or rely on docs app `dev` / CI).
3. Review diffs under `apps/docs/content/docs/sdks/athena-js/`.
4. Commit **both** package source and generated site files (same pattern as other generators).

### Add a new published page

1. Write the package doc (e.g. `docs/foo.md`).
2. Add a `pages[]` entry in `site-publish.manifest.json` (`source`, `out`, `title`, `description`).
3. Add the page `id` (or path stem) to `nav` / `authNav` as appropriate.
4. Run `docs:site:sync`.
5. Commit.

### Stop publishing a page

1. Remove it from `pages[]` and `nav`.
2. Run sync — bannered orphans are pruned; `siteOwned` files are left alone.

### Edit a site-only recipe

1. Confirm the path is listed in `siteOwned`.
2. Edit the MDX under `apps/docs/content/docs/sdks/athena-js/` directly.
3. Do **not** put that content only in the package tree unless you promote it to `pages[]`.

## What the generator does to each page

1. Read package `source`.
2. Strip any existing frontmatter.
3. Inject Fumadocs frontmatter from the manifest (`title`, `description`).
4. Prepend the generated banner comment.
5. Rewrite relative Markdown links:
   - Known published sources → `/docs/sdks/athena-js/<route>`
   - Anchors preserved (`#section`)
   - `adr/*` → monorepo GitHub blob URL under `packages/athena-js/docs/adr/...`
   - Absolute `http(s)` and existing `/docs/...` links left alone
6. Write `out` under the site tree.
7. Write root and auth `meta.json` from `nav` / `authNav`.

## How to recognize generated files

Generated MDX starts with:

```mdx
{/* Generated from packages/athena-js/docs via apps/docs/scripts/sync-athena-js-docs.mts. Do not edit by hand. */}
```

If you edit those files by hand, `docs:sync-athena-js:check` fails until you
either re-sync or move the change into the package source.

## Link rewrite examples

| In package docs | On the site |
| --- | --- |
| `[Next](./next-js.md)` | `[Next](/docs/sdks/athena-js/next-js)` |
| `[Bridge](./auth-session-bridge.md#top)` | `[Bridge](/docs/sdks/athena-js/auth/session-bridge#top)` |
| `[ADR](./adr/0014-….md)` | GitHub blob under `packages/athena-js/docs/adr/…` |

## Testing

```bash
# Unit tests for rewrite / frontmatter helpers
cd apps/docs
node --import tsx --test scripts/__tests__/sync-athena-js-docs.test.mts
# or, if tsx is unavailable:
node --experimental-strip-types --test scripts/__tests__/sync-athena-js-docs.test.mts
```

## Design rules (do not break)

1. **One narrative SoT** — package docs; site is a projection.
2. **Allowlist, not glob-all** — exclude maintainer noise by default.
3. **Never overwrite `siteOwned`** — recipe pages stay free.
4. **Check mode in CI** — drift is a failed gate, not a surprise at deploy.
5. **Commit generated output** — same as OpenAPI / `docs:from-code` artifacts.

## Related

- Package docs index: [index.md](./index.md)
- Apps docs app README: `apps/docs/README.md` (authority table)
- Script: `apps/docs/scripts/sync-athena-js-docs.mts`
- Method catalog generator (package-local): `pnpm docs:methods` → `complete-method-reference.md` (then site sync publishes it)
