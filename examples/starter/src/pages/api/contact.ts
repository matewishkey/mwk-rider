/**
 * The one route in this site that runs on demand.
 *
 * `prerender = false` opts this single endpoint out of static generation while
 * everything else stays prerendered. It is also the entire reason
 * @astrojs/cloudflare is installed — without an adapter this line fails the
 * build, which is what `modules: adapter:on-demand` checks for.
 *
 * Delivery is Cloudflare Email Service via a `send_email` binding. Sending to a
 * VERIFIED DESTINATION is free on any plan and does not count against a quota or
 * daily limit (Cloudflare, email-service/configuration/email-routing-addresses).
 * The binding in wrangler.jsonc pins `destination_address`, so this endpoint can
 * only ever mail one address — it cannot be turned into a spam relay no matter
 * what someone posts to it.
 *
 * Ships configured but inert: onboarding the domain and verifying the
 * destination address are dashboard steps, like the PageSpeed key. Until they
 * are done, submissions fail closed and say so.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { config as ogConfig } from '../../../scripts/og.config.mjs';

export const prerender = false;

const { brand } = ogConfig;

// Enough to keep a runaway paste out of an inbox, and far under the 5 MiB
// message ceiling.
const MAX_FIELD = 5_000;

export const POST: APIRoute = async ({ request }) => {
  const form = await request.formData();
  const name = field(form, 'name');
  const email = field(form, 'email');
  const message = field(form, 'message');

  // Honeypot: a human never sees this input, so anything in it is a bot. Answer
  // exactly as if it worked — telling a bot it was caught only teaches it.
  if (field(form, 'website')) return seeOther('/contact/thanks');

  if (!name || !email || !message) return seeOther('/contact?error=missing');

  try {
    await env.EMAIL.send({
      from: `noreply@${new URL(brand.siteUrl).hostname}`,
      to: brand.contactEmail,
      // The visitor's address goes in replyTo, never in `from`: sending as them
      // would fail SPF/DKIM for their domain and land the whole thing in spam.
      replyTo: email,
      subject: `${brand.siteName} — message from ${name}`,
      text: `From: ${name} <${email}>\n\n${message}\n`,
    });
  } catch {
    // Fail closed and visibly. A form that silently swallows messages is worse
    // than one that is obviously broken.
    return seeOther('/contact?error=send');
  }

  // 303 so a refresh does not resubmit, and so the browser does a plain GET of
  // the thanks page. No JavaScript involved anywhere in this flow.
  return seeOther('/contact/thanks');
};

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim().slice(0, MAX_FIELD) : '';
}

function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}
