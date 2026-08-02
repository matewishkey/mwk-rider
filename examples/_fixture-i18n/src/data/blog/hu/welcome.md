---
title: Üdv az i18n teszt-oldalon
date: 2026-05-27
tags: [meta, teszt]
excerpt: Ez az oldal a td-rider contract többnyelvű mintáit gyakoroltatja. Két nyelv, párosított fordítások, csak-egy-nyelvű posztok. Helyi futtatásra való.
draft: false
type: thoughts
locale: hu
translationKey: welcome
---

Ez a teszt-oldal a td-rider contract §18 többnyelvű mintáinak gyakorlóterepe. Csak helyileg fut — nincs igazi telepítés, nincs igazi R2-bucket. A célja, hogy a lektor kattintható oldalt kapjon a telefonján mielőtt bármelyik többnyelvű minta éles weboldalra (például a example.com-ra) kerülne.

Két nyelv: az **angol** (alapértelmezett, a `/`, `/blog` és hasonló útvonalakon) és a **magyar** (a `/hu/` alatt). Az Astro i18n konfiguráció `prefixDefaultLocale: false` beállítással fut, így az angol URL-ek tiszták maradnak.

Ennek a posztnak van angol párja — közös `translationKey: welcome` köti össze őket. Nézd meg az oldal tetején az "English translation →" linket, majd a forráskódban a `<link rel="alternate" hreflang="en-US">` sort, ami a párra mutat. Kölcsönösség: az angol poszt is visszahivatkozik ide.

A teszt-oldal többi posztja a következőket gyakoroltatja:

- Csak-angol nyelvű poszt (`standalone`)
- Csak-magyar nyelvű poszt (`csak-magyar`)
- Nyelvenkénti keresőindex a megfelelő szótővel
- A `/preview/` előnézet-polc
