---
title: Csak magyarul — fordítatlan gondolat
date: 2026-05-18
tags: [meta, fordítatlan]
excerpt: Ez a poszt csak magyarul létezik. Nincs translationKey, nincs angol pár. A "csak-egy-nyelvű poszt" viselkedését teszteli az SEO- és listázó-rétegben.
draft: false
type: thoughts
locale: hu
---

Néha egy poszt csak egy nyelven kell hogy létezzen. Lehet, hogy a téma túlságosan helyi. Lehet, hogy a fordítás a tennivalók listáján van, de még nem készült el. Akárhogyan is, a contractnak ezt is gond nélkül kell kezelnie.

A séma azért teszi opcionálissá a `translationKey` mezőt, hogy ez működjön. Ha egy posztnak nincs kulcsa, akkor nincs párja, nincsenek hreflang alternatívák, és nincs az az elvárás, hogy a többi nyelven is meg kell jelennie.

## Mit gyakoroltat ez

- A magyar blog-listázó mutatja ezt a posztot; az angol nem.
- A `<SEO />` nem ad ki `<link rel="alternate">` sort (a canonical-en kívül).
- A magyar keresőindexben benne van; az angolban nincs.
- A magyar `/llms-hu.txt`-ben szerepel; az angolban nem.
- A magyar `/rss-hu.xml`-ben szerepel; az angol feed-ben nincs.

A `<link rel="alternate" hreflang="en-US">` hiánya — ha megnyitod a forrást — az a teszt. Nem egy hiányzó funkció.
