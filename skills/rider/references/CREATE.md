# Create mode — scaffold a new site

You are building someone a working Astro site. Assume they are new to this: they
may not know what an adapter is, and they should not have to.

**You copy the starter and edit it. You never write these files from memory.**
`~/.claude/rider-starter` is a compliant site that the audit keeps clean on every
commit; anything you invent instead has never been checked by anything. If that
path is missing, say **"re-run `./install.sh` in the rider repo"** and stop — do
not improvise a site.

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
2. **Copy `~/.claude/rider-starter`** into it, **excluding everything the
   starter's own `.gitignore` lists** — read it rather than trusting this
   sentence, so the two cannot drift. Today that is `node_modules`, `dist`,
   `.astro`, `.env`, `.wrangler`, `worker-configuration.d.ts` and `.DS_Store`:
   build output and local caches, none of which belong in a fresh site.
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
   - Delete `src/data/blog/_unfinished.md` only if they ask; it is there to show
     the draft filter working.
4. **`npm install`**, then **`npm run build`**.
5. **Run the audit on what you built** and report the result. This is create
   mode's acceptance test, not a formality:
   ```bash
   node ~/.claude/rider-tools/audit.mjs --strict
   ```
   Expect `0 🔧 / 0 🛑` and two `💡`: the analytics beacon reporting its token is
   unset, and the missing Twitter handles. Both are true and both are the
   owner's to resolve. Anything else means you broke something — fix it before
   handing over.
6. **Print the two operator TODOs** (below) and nothing more.

## The two operator TODOs

Both are dashboard steps only the site owner can do. Say plainly that the site
works without them, and what does not work until they are done.

1. **Cloudflare Web Analytics** — dashboard → Web Analytics → add the site, paste
   the token into `scripts/og.config.mjs`. Until then the site collects no
   analytics.
2. **Cloudflare Email Service** — onboard the sending domain, verify the
   destination address. Until then the contact form fails closed: it redirects
   back with an error rather than pretending to have sent.

## Must not

- Run `wrangler login`, `wrangler deploy`, or anything that creates a Cloudflare
  resource or spends money.
- Onboard the email domain or create the Analytics site — both are operator steps.
- Invent a token, an API key, or an email address. `null` is the honest value.
- Add search, a preview shelf, or a hand-rolled cookie banner. Web Analytics is
  cookieless, so there is nothing to consent to.
- Write into a non-empty directory without confirming.
- Touch `~/.claude`, or any other project's `CLAUDE.md`.
- Claim the site is deployed, or collecting analytics, when it is neither.

## Where the rules live

Do not restate the baseline here or in anything you generate. There are two
authorities and this file is neither:

- **What the baseline is** — `node ~/.claude/rider-tools/audit.mjs --rules --json`
- **Why** — `BEST-PRACTICES.md` in the rider repo

The site you create ships its own `CLAUDE.md` explaining how it is built. That
one is for the site's owner; leave it in place.
