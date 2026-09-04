# Create mode — scaffold a new site

You are building someone a working Astro site. Assume they are new to this: they
may not know what an adapter is, and they should not have to.

**You copy the starter and edit it. You never write these files from memory.**
`${CLAUDE_PLUGIN_ROOT}/examples/starter` is a compliant site that the audit keeps
clean on every commit; anything you invent instead has never been checked by
anything. It ships inside this plugin, so it is always the version this file was
written against — if it is somehow missing, say so and stop rather than
improvising a site.

## Ask three questions, then stop asking

Every extra question is a chance to stall someone who just wanted a website.

1. **Site name and domain** — e.g. "Tasman Ferns" and `tasmanferns.com`. If they
   have no domain yet, use `example.com` and tell them the one file to change
   later.
2. **Contact email** — where the contact form should deliver.
3. **One-line tagline** — what the site is about.

Everything else has a default. Colours, fonts and layout are *"change them on
`/design` later"* — that page exists so those are not decisions to make now.

## Then

1. **Check the target directory.** If it is not empty, say what is in it and ask
   before writing anything.
2. **Copy `${CLAUDE_PLUGIN_ROOT}/examples/starter`** into it, **excluding everything the
   starter's own `.gitignore` lists** — read the file, and do not trust any list
   written down elsewhere including this one. It is build output, local caches
   and generated assets, none of which belong in a fresh site. (An enumeration
   used to sit here and had already gone stale, in the very sentence warning
   that it would.)
3. **Edit, don't rewrite:**
   - `scripts/og.config.mjs` — `siteName`, `siteUrl`, `tagline`, `contactEmail`,
     and **`authorName` / `authorUrl`**, which default to `Example` /
     `https://example.com` and otherwise ship inside the site's published JSON-LD
     as its author. Set them from the answers you already have (the site name and
     its URL are a correct default; a person's name is better if they give one).
     Leave `cloudflareAnalyticsToken` and both `twitter*` fields `null` — the
     first you cannot know, and an invented handle credits a stranger's account.
   - `wrangler.jsonc` — `name` (the Worker name) and
     `send_email[0].destination_address` (the same contact email).
   - `package.json` — `name`, `description`.
   - `public/logo.svg` — replace the placeholder wordmark with the site name.
     Set in type, that is a finished logo and needs nothing further. If they ask
     for a drawn mark or artwork instead, **suggest an image model rather than
     drawing one badly by hand**. Two things to be straight
     about when you do: it needs *their* API key, and it bills them per image.
     Generate the file, save it into `public/`, and stop there — the key never
     goes into the site, and the build stays static with nothing calling out to
     the service at runtime. Do not reach for this uninvited; a wordmark is the
     default and it is a good one.
   - Delete `src/data/blog/_unfinished.md` only if they ask; it is there to show
     the draft filter working.
4. **`npm install`**, then **`npm run build`**.
5. **Run the audit on what you built** and report the result. This is create
   mode's acceptance test, not a formality:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/tools/audit.mjs --strict
   ```
   **`0 🔧 / 0 🛑` is the acceptance test.** Anything required means you broke
   something — fix it before handing over.

   The `💡` are a different matter: read them, do not count them. They are the
   starter's own standing advisories — an analytics beacon whose token is unset,
   unset Twitter handles, a thank-you page reached by redirect and so linked from
   nowhere — all true, all the owner's to resolve, and their number moves whenever
   a house-style check is added. A count written down here was wrong within a day
   of the check that changed it, and it told create mode to go and "fix" a
   compliant starter. Judge the 🔧/🛑 line, never the 💡 tally.
6. **Print the three operator TODOs** (below) and nothing more.

## The three operator TODOs

All three are steps only the site owner can do. Say plainly that the site works
without them, and what does not work until they are done.

1. **Cloudflare Web Analytics** — dashboard → Web Analytics → add the site, paste
   the token into `scripts/og.config.mjs`. Until then the site collects no
   analytics.
2. **Cloudflare Email Service** — onboard the sending domain, verify the
   destination address. Until then the contact form fails closed: it redirects
   back with an error rather than pretending to have sent.
3. **A media bucket** — the site's `CLAUDE.md` § Operator steps has the two
   wrangler commands. Until then a post's `cover:` is a file next to the post
   and Astro resizes it at build, which is fine for a few images; once the
   bucket exists, `npm run media` moves photos to R2 and Cloudflare resizes
   them at the edge.

## Must not

- Run `wrangler login`, `wrangler deploy`, or anything that creates a Cloudflare
  resource or spends money.
- Onboard the email domain or create the Analytics site — both are operator steps.
- Invent a token, an API key, or an email address. `null` is the honest value.
- Add search, a preview shelf, or a hand-rolled cookie banner. Web Analytics is
  cookieless, so there is nothing to consent to.
- Add, suggest, or leave a comment recommending any third-party library or
  service the user did not name — a form vendor, a font CDN, an icon package, a
  search SaaS, a comments widget. The starter already has a Cloudflare-native
  answer for everything it needs, and a typed endpoint is easier to write than a
  product is to integrate. If the user asks for one by name, that is a request;
  an unprompted "you could also use X" is not.
- Write into a non-empty directory without confirming.
- Touch `~/.claude`, or any other project's `CLAUDE.md`.
- Claim the site is deployed, or collecting analytics, when it is neither.

## Where the rules live

Do not restate the baseline here or in anything you generate. There are two
authorities and this file is neither:

- **What the baseline is** — `node ${CLAUDE_PLUGIN_ROOT}/tools/audit.mjs --rules --json`
- **Why** — `${CLAUDE_PLUGIN_ROOT}/BEST-PRACTICES.md`

The site you create ships its own `CLAUDE.md` explaining how it is built. That
one is for the site's owner; leave it in place.
