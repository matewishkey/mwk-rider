---
title: Két írási útvonal — a média és a kód nem közös csővezeték
date: 2026-05-20
tags: [architektúra, deploy]
excerpt: Egyetlen "deploy" mögé bújik az a tény, hogy a média és a kód mást kér az infrastruktúrától. A contract szétválasztja őket. Itt a miért.
draft: false
type: thoughts
locale: hu
translationKey: two-write-paths
---

A legtöbb statikus oldal-felépítés egyetlen műveletként kezeli a "deploy"-t. Build, push, kész. Ez a modell egészen addig működik, amíg nincs kétféle, eltérő jellegű írási feladatod — onnantól csendben elkezd zavarba ejtő módokon megbicsaklani.

## Hogy néznek ki valójában az írások

A kód-írások kicsik, determinisztikusak, és build lépést igényelnek. Markdown-test átírása, layout-hibajavítás, új tag hozzáadása — mindegyikhez újra kell renderelni a HTML-t.

A média-írások mások. Egy új hero-kép egyetlen bináris fájl, egyetlen kulcson, az objektum-tárolóban. Nincs build lépés. A HTML már URL-en hivatkozza a kulcsot; a CDN azt szolgálja ki, ami épp ott van.

## Az útvonalak szétválasztása

A wishbusterz-rider így nevezi őket:

- **A útvonal — média → R2.** Az operátor gépéről fut. Helyben generálja a képeket, közvetlenül a CF API-n keresztül R2-be tölti. Nincs build.
- **B útvonal — kód → Workers Builds.** A `git push origin main` indítja. A CF felveszi a push-t, build-el, kiküldi a `dist/`-et. Kb. 30–90s.

Egy új operátor bármely laptopról közzétehet tartalmi frissítést, csak `git clone && edit && git push` kell. Az A-útvonal hitelesítő adataira csak akkor van szükség, ha valaki képet is generál — a legtöbben nem.
