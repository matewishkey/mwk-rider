---
title: Preview — Thoughts type
date: 2026-05-26
tags: [preview, regression]
excerpt: Example post for the "thoughts" type. Routed only to /preview/posts/_preview-thoughts. Exercises every markdown feature so layout regressions are visible.
draft: false
type: thoughts
locale: en
previewOnly: true
---

This post is `previewOnly: true` per. It never appears in the public feed, sitemap, RSS, search index, or llms.txt. It exists to exercise the post layout for the **thoughts** type.

## Heading level 2

Paragraph after H2. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

### Heading level 3

A nested heading. Paragraph follows.

## Lists

Unordered:

- First item
- Second item
- Third item with nested:
  - Nested A
  - Nested B

Ordered:

1. Step one
2. Step two
3. Step three

## Code

Inline `code` looks like this. A fenced code block:

```ts
function greet(name: string): string {
  return `hello, ${name}`;
}
```

## Blockquote

> A blockquote pulls the eye. Preview posts exercise every Markdown feature so layout regressions surface in QA before they hit a real post.

## Table

| Column A | Column B |
|---|---|
| One | Two |
| Three | Four |

## Inline link

An [inline link](https://example.invalid/) — the link form of cross-post reference.

End of preview content.
