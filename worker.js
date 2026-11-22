// Map link resolver - Cloudflare Worker
// Follows a Google Maps short link (maps.app.goo.gl/...) and returns the long address.
// It never fetches the final page, never stores anything and keeps no logs of its own.

// Pages allowed to call this Worker (add your own site here).
const ALLOWED_ORIGINS = [
  "https://YOUR-SITE.netlify.app",
  "http://127.0.0.1:5500",   // VS Code Live Server
  "http://localhost:5500",
  "http://10.0.2.2:5500"     // Android emulator reaching Live Server
];

const MAX_HOPS = 5;
const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

function isShortLink(u) {
  return u.protocol === "https:" &&
    (u.hostname === "maps.app.goo.gl" ||
     (u.hostname === "goo.gl" && u.pathname.startsWith("/maps")));
}
function isGoogleMaps(u) {
  return u.protocol === "https:" &&
    /^(?:www\.|maps\.)?google\.[a-z.]{2,10}$/.test(u.hostname) &&
    u.pathname.startsWith("/maps");
}

function reply(body, status, origin) {
  const h = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Vary"] = "Origin";
  }
  return new Response(JSON.stringify(body), { status, headers: h });
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin");
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return reply({ error: "Origin not allowed" }, 403, null);
    }
    if (request.method !== "GET") {
      return reply({ error: "Use GET" }, 405, origin);
    }

    const input = new URL(request.url).searchParams.get("url");
    let current;
    try { current = new URL(input); } catch (e) {
      return reply({ error: "Missing or invalid url" }, 400, origin);
    }
    if (!isShortLink(current)) {
      return reply({ error: "Only Google Maps short links are supported" }, 400, origin);
    }

    try {
      for (let i = 0; i < MAX_HOPS; i++) {
        const res = await fetch(current.href, {
          redirect: "manual",
          headers: { "User-Agent": UA }
        });
        const loc = res.headers.get("Location");
        if (res.body) { res.body.cancel(); }
        if (res.status < 300 || res.status > 399 || !loc) {
          return reply({ error: "The short link did not redirect" }, 502, origin);
        }
        const next = new URL(loc, current);
        if (isGoogleMaps(next)) {
          return reply({ url: next.href }, 200, origin);   // found it, do not fetch the page
        }
        if (!isShortLink(next)) {
          return reply({ error: "Redirected somewhere unexpected" }, 502, origin);
        }
        current = next;
      }
      return reply({ error: "Too many redirects" }, 502, origin);
    } catch (e) {
      return reply({ error: "Could not reach the short link" }, 502, origin);
    }
  }
};
