---
title: An untranslated thought
date: 2026-05-18
tags: [meta, untranslated]
excerpt: This post exists only in English. No translationKey, no Hungarian sibling. Tests the "locale-only post" behavior of the SEO and listing layer.
draft: false
type: thoughts
locale: en
---

Some posts only need to exist in one language. Maybe the topic is too local. Maybe a translation is on the to-do list but hasn't happened yet. Either way, the contract has to handle it gracefully.

The schema makes `translationKey` optional precisely for this. A post without a key has no siblings, no hreflang alternates emitted, and no expectation that other locales will offer the same content.

## What this exercises

- The English blog listing should show this post; the Hungarian listing should not.
- `<SEO />` should emit no `<link rel="alternate">` for this page (besides the canonical itself).
- The English search index includes this post; the Hungarian one does not.
- The English `/llms.txt` includes this post; the Hungarian one does not.
- The English `/rss-en.xml` includes this post; the Hungarian feed does not.

If you open this post in the browser and view source, the absence of `<link rel="alternate" hreflang="hu-HU">` is the test — not a missing feature.
