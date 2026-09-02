---
title: A többnyelvű stack felépítése
date: 2026-05-25
tags: [projekt, astro, i18n]
excerpt: Hogyan ültethetők át a contractmintái Astro 6-ra — i18n útválasztás, séma-bővítés, nyelvenkénti végpontok, SEO hreflanggel. Ez a teszt-oldal felépítése.
draft: false
type: project
locale: hu
translationKey: first-project
---

A contract a-ban a többnyelvű támogatást rétegzett alapértelmezésekként írja le. Ez a teszt-oldal megmutatja, hogy néznek ki ezek az alapértelmezések valódi Astro 6 projektbe bekötve.

## A bekötés

Öt dolog változik, amikor egy oldal egynyelvűből többnyelvűvé válik:

1. **`astro.config.mjs`** — kap egy `i18n` blokkot `defaultLocale`, `locales`, `prefixDefaultLocale: false` és egy `fallback` térképpel.
2. **`src/content.config.ts`** — a séma `locale: z.enum([...])` (kötelező) és `translationKey: z.string().optional()` mezőket kap.
3. **Tartalom-elrendezés** — a posztok a `src/data/blog/<nyelv>/<slug>.md` alkönyvtárakba kerülnek; a `generateId` eltávolítja az előtagot, hogy az `entry.id` nyelv-független maradjon.
4. **Felfedezési végpontok** — a `search-index`, `RSS` és `llms.txt` mindegyike `[locale]` paraméteressé válik. Egyetlen szűrőkifejezés (`!draft && !previewOnly && locale === current`) vezérli mindet.
5. **SEO** — a kanonikus `<SEO />` komponens kap egy hreflang blokkot, amit a `translationKey` (posztoknál) vagy a `getRelativeLocaleUrlList` (kerítő-oldalaknál) vezérel.

## Miért létezik ez a teszt-oldal

A contract dokumentálja a mintákat; ez a teszt-oldal bizonyítja, hogy lefordulnak és kiszolgálhatók. Mielőtt bármilyen többnyelvű változtatás a `example.com`-on landolna, először itt kattintgatunk.
