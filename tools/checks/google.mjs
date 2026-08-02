// google — is the site registered and measured in Google's properties?
//
// Runs only with --url, and only when credentials are present (skips gracefully
// otherwise, exactly like the lighthouse PSI key). It verifies the operator-
// provisioned Google state that nothing in the site source can reveal:
//
//   • gsc:verified   the domain is a verified Search Console property (sc-domain:)
//   • gsc:sitemap    a sitemap is submitted to Search Console
//   • ga:property    a GA4 property + web data stream exists for the domain (→ G-…)
//   • zaraz:ga       that GA4 measurement ID is wired into the zone's Zaraz config
//
// The Search Console + GA legs use a Google service-account token (see
// tools/lib/google-auth.mjs). The Zaraz leg uses $CLOUDFLARE_API_TOKEN — the same
// token the cloudflare skill uses — and resolves the zone from the domain. Each leg
// skips independently when its credential is missing or its API rejects the call,
// so a partial setup still reports what it can.
//
// This is the *verify* half of automatic GSC/GA intake: an operator (or a future
// provisioning tool) creates the property, submits the sitemap, and wires Zaraz;
// td-rider confirms it landed. The tool never provisions — it checks.

import { getAccessToken } from '../lib/google-auth.mjs';

const SEC = 'google';
const GA_ID_RE = /G-[A-Z0-9]{6,}/;
const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const GA_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

export async function run({ reporter, url }) {
  const domain = hostFromUrl(url);
  if (!domain) { reporter.skip(SEC, 'domain', `could not parse a host from --url ${url}`); return; }

  // Search Console + GA Admin share one service-account token.
  const auth = await getAccessToken([GSC_SCOPE, GA_SCOPE]);
  let measurementId = null;
  if (auth.skip) {
    reporter.skip(SEC, 'auth', `${auth.skip} — skipping Search Console + GA checks`);
  } else {
    await checkSearchConsole(reporter, auth.token, domain);
    measurementId = await checkAnalytics(reporter, auth.token, domain);
  }

  // Zaraz wiring is independent — uses the Cloudflare token, not the SA.
  await checkZaraz(reporter, domain, measurementId);
}

async function checkSearchConsole(reporter, token, domain) {
  const site = `sc-domain:${domain}`;
  const enc = encodeURIComponent(site);

  const sres = await gfetch(`https://www.googleapis.com/webmasters/v3/sites/${enc}`, token);
  if (sres.status === 404) {
    reporter.fix(SEC, 'gsc:verified', `not a verified Search Console property (${site})`,
      'add + DNS-TXT-verify the domain via the Site Verification + Search Console APIs (the TXT record goes in via the Cloudflare DNS API), then submit the sitemap');
    return; // no point listing sitemaps for a property that isn't there
  }
  if (!sres.ok) {
    reporter.skip(SEC, 'gsc:verified', `Search Console sites.get HTTP ${sres.status}${sres.status === 403 ? ' — grant the service account access in Search Console, and enable the Search Console API' : ''}`);
    return;
  }
  const sjson = await sres.json().catch(() => ({}));
  const level = sjson.permissionLevel ?? 'unknown';
  if (level === 'siteUnverifiedUser') {
    reporter.fix(SEC, 'gsc:verified', `${site} exists but is unverified`, 'complete the DNS-TXT verification step');
  } else {
    reporter.pass(SEC, 'gsc:verified', `${site} (${level})`);
  }

  const mres = await gfetch(`https://www.googleapis.com/webmasters/v3/sites/${enc}/sitemaps`, token);
  if (!mres.ok) { reporter.skip(SEC, 'gsc:sitemap', `Search Console sitemaps.list HTTP ${mres.status}`); return; }
  const maps = (await mres.json().catch(() => ({}))).sitemap ?? [];
  if (!maps.length) {
    reporter.fix(SEC, 'gsc:sitemap', 'no sitemap submitted to Search Console',
      'submit the sitemap (e.g. /sitemap-index.xml) via the Search Console sitemaps.submit API');
    return;
  }
  const withErrors = maps.filter((m) => Number(m.errors) > 0);
  if (withErrors.length) {
    reporter.suggest(SEC, 'gsc:sitemap', `${maps.length} sitemap(s) submitted, ${withErrors.length} reporting errors`, 'open the sitemap detail in Search Console to see the parse errors');
  } else {
    reporter.pass(SEC, 'gsc:sitemap', `${maps.length} sitemap(s) submitted`);
  }
}

async function checkAnalytics(reporter, token, domain) {
  const ares = await gfetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', token);
  if (!ares.ok) {
    reporter.skip(SEC, 'ga:property', `GA Admin accountSummaries HTTP ${ares.status}${ares.status === 403 ? ' — grant the service account access to the GA account, and enable the Analytics Admin API' : ''}`);
    return null;
  }
  const summaries = (await ares.json().catch(() => ({}))).accountSummaries ?? [];
  const props = summaries.flatMap((a) => a.propertySummaries ?? []);
  if (!props.length) {
    reporter.fix(SEC, 'ga:property', 'no GA4 properties are visible to the service account',
      'create a GA4 property for this site (Admin API properties.create) or grant the SA access to the account that owns it');
    return null;
  }

  for (const p of props) {
    // p.property is "properties/123456789"
    const dres = await gfetch(`https://analyticsadmin.googleapis.com/v1beta/${p.property}/dataStreams?pageSize=200`, token);
    if (!dres.ok) continue;
    const streams = (await dres.json().catch(() => ({}))).dataStreams ?? [];
    for (const ds of streams) {
      const web = ds.webStreamData;
      if (web?.defaultUri && hostFromUrl(web.defaultUri) === domain && web.measurementId) {
        reporter.pass(SEC, 'ga:property', `GA4 ${web.measurementId} — “${p.displayName}”`);
        return web.measurementId;
      }
    }
  }
  reporter.fix(SEC, 'ga:property', `no GA4 web data stream matches ${domain}`,
    'create a GA4 property + web data stream whose URL is this domain (Admin API properties.create → properties.dataStreams.create), then read back its measurement ID');
  return null;
}

async function checkZaraz(reporter, domain, measurementId) {
  const cfToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!cfToken) {
    reporter.skip(SEC, 'zaraz:ga', 'no $CLOUDFLARE_API_TOKEN — cannot read the Zaraz config to confirm the GA tag is wired');
    return;
  }
  const zoneId = await resolveZone(cfToken, domain);
  if (!zoneId) {
    reporter.skip(SEC, 'zaraz:ga', `no Cloudflare zone for ${domain} (the token lacks access, or this domain's DNS isn't on this account)`);
    return;
  }
  let res;
  try {
    res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/settings/zaraz/config`, {
      headers: { Authorization: `Bearer ${cfToken}` },
    });
  } catch (e) { reporter.skip(SEC, 'zaraz:ga', `network error reaching the Zaraz config API: ${e.message}`); return; }
  if (!res.ok) { reporter.skip(SEC, 'zaraz:ga', `Zaraz config HTTP ${res.status} (token may lack the Zaraz read permission)`); return; }
  const config = (await res.json().catch(() => ({}))).result;
  if (!config) { reporter.skip(SEC, 'zaraz:ga', 'Zaraz config response had no result'); return; }

  const blob = JSON.stringify(config); // match key-name-agnostically: the ID appears in the GA tool's settings
  if (measurementId) {
    if (blob.includes(measurementId)) {
      reporter.pass(SEC, 'zaraz:ga', `${measurementId} wired into Zaraz`);
    } else {
      reporter.fix(SEC, 'zaraz:ga', `GA4 ${measurementId} is not present in the zone's Zaraz config`,
        'add a Google Analytics tool in Zaraz with this measurement ID, assigned to a consent purpose so it fires behind the CMP');
    }
    return;
  }
  // No measurement ID to cross-check (GA leg skipped/unmatched) — at least confirm a GA tag exists.
  if (GA_ID_RE.test(blob) || /google\s*analytics|googleanalytics|gtag/i.test(blob)) {
    reporter.suggest(SEC, 'zaraz:ga', 'a Google Analytics tag is present in Zaraz (could not cross-check the exact measurement ID — GA Admin leg unavailable)',
      'confirm the GA4 measurement ID in Zaraz matches the property for this site');
  } else {
    reporter.fix(SEC, 'zaraz:ga', "no Google Analytics tool found in the zone's Zaraz config",
      'add a GA4 tool in Zaraz behind the consent CMP');
  }
}

async function resolveZone(cfToken, domain) {
  // Try the host, then its registrable parent (a zone is usually the apex).
  const names = [domain];
  const parts = domain.split('.');
  if (parts.length > 2) names.push(parts.slice(-2).join('.'));
  for (const name of names) {
    let res;
    try { res = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(name)}`, { headers: { Authorization: `Bearer ${cfToken}` } }); }
    catch { continue; }
    if (!res.ok) continue;
    const id = (await res.json().catch(() => ({}))).result?.[0]?.id;
    if (id) return id;
  }
  return null;
}

function hostFromUrl(u) {
  try { return new URL(u.includes('://') ? u : `https://${u}`).hostname.replace(/^www\./, ''); }
  catch { return null; }
}

function gfetch(url, token) {
  return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
}
