---
title: Building the multi-locale stack
date: 2026-05-25
tags: [project, astro, i18n]
excerpt: How the contract's §18 patterns map onto Astro 6 — i18n routing, schema additions, per-locale endpoints, SEO with hreflang. The work that built this fixture.
draft: false
type: project
locale: en
translationKey: first-project
---

The contract talks about multi-locale in §18 as a layered set of defaults. This fixture is what those defaults look like once they're wired into a real Astro 6 project.

## The wiring

Five things move when a site goes from mono-locale to multi-locale:

1. **`astro.config.mjs`** — adds the `i18n` block with `defaultLocale`, `locales`, `prefixDefaultLocale: false`, and a `fallback` map.
2. **`src/content.config.ts`** — schema gains `locale: z.enum([...])` (required) and `translationKey: z.string().optional()`.
3. **Content layout** — posts move into `src/data/blog/<locale>/<slug>.md` subdirectories; `generateId` strips the prefix so `entry.id` stays locale-neutral.
4. **Discovery endpoints** — `search-index`, `RSS`, `llms.txt` each become `[locale].json.ts` / `[locale].xml.ts` / `[locale].txt.ts`. One predicate (`!draft && !previewOnly && locale === current`) governs all of them.
5. **SEO** — the canonical `<SEO />` component grows a hreflang block driven by `translationKey` (posts) or `getRelativeLocaleUrlList` (chrome pages).

## Why this fixture exists

The contract documents the patterns; this fixture proves they compile and serve. Before any multi-locale change lands on `example.com`, we click around here first.
