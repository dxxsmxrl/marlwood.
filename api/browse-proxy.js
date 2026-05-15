const BLOCKED_HOSTS = /^localhost$|^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./i;

function rewriteHtml(html, targetUrl) {
  if (!/<base\s/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, (m) => `${m}<base href="${targetUrl}">`);
  }
  html = html.replace(/<meta[^>]+http-equiv=["']?X-Frame-Options["']?[^>]*>/gi, "");
  html = html.replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, "");
  if (/google\./i.test(targetUrl)) {
    html = html.replace(/<div[^>]+id=["']?og-teaser["']?[^>]*>[\s\S]*?<\/div>/gi, "");
    html = html.replace(/data-ved=["'][^"']*["']/gi, "");
  }
  return html;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).send("Method not allowed");
    return;
  }

  const target = req.query.url;
  if (!target || !/^https?:\/\//i.test(target)) {
    res.status(400).send("Missing or invalid url parameter");
    return;
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    res.status(400).send("Invalid URL");
    return;
  }

  if (!["http:", "https:"].includes(parsed.protocol) || BLOCKED_HOSTS.test(parsed.hostname)) {
    res.status(403).send("URL not allowed");
    return;
  }

  /* ?geo=us — доп. сигнал «десктоп US» (основная география = IP сервера Vercel в США/EU) */
  const usGeo = req.query.geo === "us";
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (usGeo) headers["Sec-CH-UA-Platform"] = '"Windows"';

  try {
    const upstream = await fetch(target, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });

    const type = upstream.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("application/xhtml")) {
      res.redirect(302, target);
      return;
    }

    let html = await upstream.text();
    html = rewriteHtml(html, upstream.url || target);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(upstream.status).send(html);
  } catch (err) {
    console.error("browse-proxy:", err);
    res.status(502).send(`Proxy error: ${err.message || "fetch failed"}`);
  }
}
