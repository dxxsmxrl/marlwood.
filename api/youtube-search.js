const PIPED = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.in.projectsegfau.lt",
  "https://api.piped.private.coffee",
  "https://pipedapi.adminforge.de",
];

const INVIDIOUS = [
  "https://yewtu.be",
  "https://invidious.fdn.fr",
  "https://vid.puffyan.us",
  "https://inv.nadeko.net",
  "https://invidious.privacyredirect.com",
];

function parseVideoId(urlOrId) {
  if (!urlOrId) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) return urlOrId;
  const m = String(urlOrId).match(/(?:v=|youtu\.be\/|\/vi\/|embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

function mapItems(list) {
  return list
    .filter((x) => x.videoId)
    .slice(0, 12)
    .map((x) => ({
      videoId: x.videoId,
      title: x.title || "Video",
      thumb: x.thumb || `https://i.ytimg.com/vi/${x.videoId}/mqdefault.jpg`,
      channel: x.channel || "",
    }));
}

async function searchPiped(q) {
  let lastErr;
  for (const base of PIPED) {
    try {
      const url = `${base}/search?q=${encodeURIComponent(q)}&filter=videos`;
      const r = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "amina-search/1.0" },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const raw = data.items || data.results || [];
      const items = raw
        .map((x) => ({
          videoId: parseVideoId(x.url || x.videoId || x.id),
          title: x.title,
          thumb: x.thumbnail || x.thumbnailUrl,
          channel: x.uploaderName || x.author || "",
        }))
        .filter((x) => x.videoId);
      if (!items.length) throw new Error("empty");
      return mapItems(items);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("piped failed");
}

async function searchInvidious(q) {
  let lastErr;
  for (const base of INVIDIOUS) {
    try {
      const url = `${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video`;
      const r = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (!Array.isArray(data)) throw new Error("bad response");
      const items = data
        .filter((x) => x.type === "video" && x.videoId)
        .map((x) => ({
          videoId: x.videoId,
          title: x.title || "Video",
          thumb:
            x.videoThumbnails?.find((t) => t.quality === "medium")?.url ||
            x.videoThumbnails?.[0]?.url,
          channel: x.author || "",
        }));
      if (!items.length) throw new Error("empty");
      return mapItems(items);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("invidious failed");
}

async function searchYouTubeApi(q) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;

  const params = new URLSearchParams({
    part: "snippet",
    q,
    type: "video",
    maxResults: "12",
    key,
    safeSearch: "none",
    regionCode: "US",
    relevanceLanguage: "en",
  });

  const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!r.ok) {
    const err = await r.text();
    throw new Error(err.slice(0, 120));
  }
  const data = await r.json();
  const items = (data.items || [])
    .filter((i) => i.id?.videoId)
    .map((i) => ({
      videoId: i.id.videoId,
      title: i.snippet.title,
      thumb: i.snippet.thumbnails?.medium?.url,
      channel: i.snippet.channelTitle || "",
    }));
  return items.length ? mapItems(items) : null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const q = (req.query.q || "").trim();
  if (!q) {
    res.status(400).json({ error: "missing q" });
    return;
  }

  const errors = [];

  try {
    const items = await searchYouTubeApi(q);
    if (items?.length) {
      res.status(200).json({ items, source: "youtube-api" });
      return;
    }
  } catch (e) {
    errors.push("api:" + e.message);
  }

  try {
    const items = await searchPiped(q);
    res.status(200).json({ items, source: "piped" });
    return;
  } catch (e) {
    errors.push("piped:" + e.message);
  }

  try {
    const items = await searchInvidious(q);
    res.status(200).json({ items, source: "invidious" });
    return;
  } catch (e) {
    errors.push("inv:" + e.message);
  }

  console.error("youtube-search failed:", errors.join(" | "));
  res.status(502).json({
    error: "search failed",
    message: "All search backends unavailable. Add YOUTUBE_API_KEY in Vercel settings for reliable search.",
    detail: errors.join("; "),
  });
}
