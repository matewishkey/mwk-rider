---
title: Something I haven't finished
date: 2026-08-02
tags: [meta]
excerpt: A draft, here on purpose — it must not appear on the blog index, in the feed, in llms.txt or in the sitemap. Delete it once you trust that.
draft: true
---

This post exists to prove the draft filter works.

`draft: true` keeps it out of the blog index, the RSS feed, `/llms.txt` and the
sitemap — all four, because all four call the same `isPublished` predicate in
`src/lib/posts.ts`. One function, so they cannot disagree.

Check it after a build: this title should appear in none of them.
