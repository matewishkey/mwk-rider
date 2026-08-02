---
title: Welcome to the i18n fixture
date: 2026-05-27
tags: [meta, fixture]
excerpt: This site exercises the wishbusterz-rider contract's multi-locale patterns. Two locales, paired translations, locale-only posts. It runs only on localhost.
draft: false
type: thoughts
locale: en
translationKey: welcome
---

This fixture is the test bed for the wishbusterz-rider contract's §18 multi-locale patterns. It runs only on localhost — never deploys, never has a real R2 bucket. Its job is to give a reviewer a clickable site they can check on a phone before any multi-locale pattern lands on a real managed site like example.com.

Two locales: **English** (the default, at root paths like `/`, `/blog`) and **Hungarian** (under `/hu/`). Astro's i18n config sets `prefixDefaultLocale: false`, so English URLs stay clean.

This post has a Hungarian sibling — they share the same `translationKey: welcome`. Look at the top of the page for the "Magyar fordítás →" link, then check the page source for `<link rel="alternate" hreflang="hu-HU">` pointing at the sibling. Reciprocity: the Hungarian post also has an alternate link pointing back here.

Other posts in the fixture exercise:

- An untranslated English post (`standalone`)
- An untranslated Hungarian post (`csak-magyar`)
- Per-locale search indexes with the right stemmer
- The preview shelf at `/preview/`
