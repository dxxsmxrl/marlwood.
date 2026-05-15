const INVIDIOUS = [
  "https://yewtu.be",
  "https://invidious.fdn.fr",
  "https://vid.puffyan.us",
  "https://inv.nadeko.net",
];

async function searchInvidious(q) {
  let lastErr;
  for (const base of INVIDIOUS) {
    try {
      const url = `${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video`;
      const r = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (!Array.isArray(data)) throw new Error("bad response");
      return data
        .filter((x) => x.type === "video" && x.videoId)
        .slice(0, 12)
        .map((x) => ({
          videoId: x.videoId,
          title: x.title || "Video",
          thumb:
            (x.videoThumbnails && x.videoThumbnails.find((t) => t.quality === "medium")?.url) ||
            (x.videoThumbnails && x.videoThumbnails[0]?.url) ||
            `https://i.ytimg.com/vi/${x.videoId}/mqdefault.jpg`,
          channel: x.author || "",
        }));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("all invidious instances failed");
}

async function searchYouTubeApi(q, geo) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;

  const params = new URLSearchParams({
    part: "snippet",
    q,
    type: "video",
    maxResults: "12",
    key,
    safeSearch: "none",
  });
  if (geo === "us") {
    params.set("regionCode", "US");
    params.set("relevanceLanguage", "en");
  }

  const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!r.ok) {
    const err = await r.text();
    throw new Error(err.slice(0, 120));
  }
  const data = await r.json();
  return (data.items || [])
    .filter((i) => i.id && i.id.videoId)
    .map((i) => ({
      videoId: i.id.videoId,
      title: i.snippet.title,
      thumb: i.snippet.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${i.id.videoId}/mqdefault.jpg`,
      channel: i.snippet.channelTitle || "",
    }));
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

  const geo = req.query.geo === "us" ? "us" : "";

  try {
    let items = null;
    try {
      items = await searchYouTubeApi(q, geo);
    } catch (e) {
      console.warn("YouTube API:", e.message);
    }
    if (!items || !items.length) {
      items = await searchInvidious(q);
    }
    res.status(200).json({ items, source: items.length ? "ok" : "empty" });
  } catch (err) {
    console.error("youtube-search:", err);
    res.status(502).json({ error: "search failed", message: String(err.message || err) });
  }
}
