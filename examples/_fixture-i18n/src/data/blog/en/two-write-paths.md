---
title: Two write paths — media and code don't share a pipeline
date: 2026-05-20
tags: [architecture, deploy]
excerpt: A single "deploy" hides the truth that media and code want different things from infrastructure. The contract splits them. Here's the why.
draft: false
type: thoughts
locale: en
translationKey: two-write-paths
---

Most static site setups treat "deploy" as one operation. Build, push, done. That model works until you have two kinds of writes with different characteristics — and then it quietly breaks in confusing ways.

## What the writes actually look like

Code writes are small, deterministic, and need a build step. Editing a markdown body, fixing a typo in the layout, adding a tag — all of these need HTML re-rendered.

Media writes are different. A new hero image is one binary file going to one key in object storage. There's no build step. The HTML already references the key by URL; the CDN serves whatever bytes are there.

## Splitting the paths

td-rider names them:

- **Path A — media → R2.** Run from the operator's machine. Generates images locally, pushes to R2 via direct CF API calls. No build.
- **Path B — code → Workers Builds.** Run via `git push origin main`. CF picks up the push, builds, ships `dist/`. ~30–90s.

A new operator can publish content updates from any laptop with just `git clone && edit && git push`. Path A credentials only matter for image generation, which most operators don't do.
