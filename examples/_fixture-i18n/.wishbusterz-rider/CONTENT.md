# Content (fixture stub)

This is the multi-locale fixture for the wishbusterz-rider framework. The posts in `src/data/blog/{en,hu}/` exist to exercise contract patterns, not to publish.

This file exists so `wishbusterz-rider check` treats the fixture as a managed-site shape.

## Paths

| Thing | Path |
|---|---|
| Collection root | `src/data/blog/` |
| Locale subdirs | `src/data/blog/en/` + `src/data/blog/hu/` (Pattern B per §18.3) |
| Schema | `src/content.config.ts` |

## Types in use

From the §8 registry: `thoughts`, `project`.

One `_preview-<type>.md` per registered type, with `previewOnly: true`, in `src/data/blog/en/`.

## Length targets

Not enforced in the fixture — posts are short stubs that exist to satisfy the Zod schema, not to read well.
