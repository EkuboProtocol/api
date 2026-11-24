import type { Context } from "hono";
import type { Env } from "../../env";
import type { AppEnv } from "../../shared/context";

export type CallbackOutcome = "complete" | "cancelled" | "failed" | "expired";

function originMatches(pattern: string, url: URL): boolean {
  const wildcard = /^(https?):\/\/\*\.([a-z0-9.-]+)$/.exec(pattern);
  if (wildcard) {
    return (
      url.protocol === `${wildcard[1]}:` &&
      url.port === "" &&
      url.hostname.endsWith(`.${wildcard[2]}`)
    );
  }
  return url.origin === pattern;
}

/** return_to must be a page on one of X_LINK_RETURN_ORIGINS. */
export function validReturnTo(env: Env, value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  const patterns = env.X_LINK_RETURN_ORIGINS.split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return patterns.some((pattern) => originMatches(pattern, url));
}

/** Return parameters: x_link and x_link_code, or x_unlink and x_unlink_code. */
export function returnUrl(
  returnTo: string,
  outcome: CallbackOutcome,
  code: string | undefined,
  flow: "link" | "unlink" = "link",
): string {
  const url = new URL(returnTo);
  url.searchParams.set(`x_${flow}`, outcome);
  if (code) url.searchParams.set(`x_${flow}_code`, code);
  return url.toString();
}

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ]!,
  );

interface PageContent {
  flow?: "link" | "unlink";
  outcome: CallbackOutcome;
  code?: string;
  handle?: string;
  address?: string;
  chainId?: string;
}

function unlinkBody(content: PageContent): { title: string; html: string } {
  return {
    title: "X account verified",
    html: `<p>X account <b>@${escape(content.handle!)}</b> verified.</p>
<p>To remove every link between this X account and wallet addresses, give this code to the app or agent where you started:</p>
<p class="code">${escape(content.code!)}</p>
<p>The code expires in 10 minutes.</p>
<p>If you did not start this, close this page: nothing is removed without this code.</p>`,
  };
}

const WORDS = {
  link: { verb: "Linking", done: "linked" },
  unlink: { verb: "Unlinking", done: "removed" },
} as const;

function body(content: PageContent): { title: string; html: string } {
  const flow = content.flow ?? "link";
  if (flow === "unlink" && content.outcome === "complete") {
    return unlinkBody(content);
  }
  const { verb, done } = WORDS[flow];
  switch (content.outcome) {
    case "complete":
      return {
        title: "X account verified",
        html: `<p>X account <b>@${escape(content.handle!)}</b> verified.</p>
<p>To finish linking it to <code>${escape(content.address!)}</code> (chain ${escape(content.chainId!)}), give this code to the app or agent where you started:</p>
<p class="code">${escape(content.code!)}</p>
<p>Then sign the message in your wallet. The code expires in 10 minutes. Once linked, anyone can see that this address belongs to @${escape(content.handle!)}.</p>
<p>If you did not start this, close this page: nothing is linked without this code and a signature from the wallet.</p>`,
      };
    case "cancelled":
      return {
        title: `${verb} cancelled`,
        html: `<p>X approval was cancelled. Nothing was ${done}.</p>`,
      };
    case "failed":
      return {
        title: `${verb} failed`,
        html: `<p>X did not confirm the account. Nothing was ${done}; start again.</p>`,
      };
    default:
      return {
        title: "Link expired",
        html: "<p>This link has expired or was already used. Start again.</p>",
      };
  }
}

export function callbackPage(c: Context<AppEnv>, content: PageContent) {
  const { title, html } = body(content);
  const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Ekubo</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5;color:#111}code{word-break:break-all}.code{font:600 2rem ui-monospace,monospace;letter-spacing:.15em;user-select:all}</style>
</head><body><h1>${title}</h1>
${html}
</body></html>`;
  return c.html(page, content.outcome === "expired" ? 400 : 200, {
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    "x-frame-options": "DENY",
  });
}
