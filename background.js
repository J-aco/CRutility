importScripts("features.js");

const MAL_CACHE_KEY = "malCache";
const MAL_HIT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAL_MISS_MAX_AGE_MS = 15 * 60 * 1000;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "mal-lookup" || typeof message.title !== "string") return;
  lookupMal(message.title).then(sendResponse, () => sendResponse(null));
  return true;
});

async function lookupMal(title) {
  const key = title.trim();
  if (!key) return null;
  const stored = await chrome.storage.local.get(MAL_CACHE_KEY);
  const cache = stored[MAL_CACHE_KEY] && typeof stored[MAL_CACHE_KEY] === "object"
    ? stored[MAL_CACHE_KEY]
    : {};
  const cached = freshRecord(cache[key]);
  if (cached) return cached;

  const hits = [];
  for (const query of searchQueries(key)) {
    let rows;
    try {
      rows = await fetchHits(query);
    } catch {
      continue;
    }
    if (!rows) continue;
    for (const row of rows) hits.push(hitFromRow(row));
    const picked = pickMalHit(key, hits);
    if (picked && picked.malId != null) {
      const record = {
        malId: picked.malId,
        score: picked.score,
        title: picked.titleEnglish || picked.title,
        fetchedAt: Date.now(),
      };
      cache[key] = record;
      await chrome.storage.local.set({ [MAL_CACHE_KEY]: cache });
      return record;
    }
  }
  if (hits.length === 0) return null;
  const miss = { malId: null, score: null, title: key, fetchedAt: Date.now() };
  cache[key] = miss;
  await chrome.storage.local.set({ [MAL_CACHE_KEY]: cache });
  return miss;
}

function freshRecord(record) {
  if (!record || typeof record.fetchedAt !== "number") return null;
  const maxAge = record.malId == null ? MAL_MISS_MAX_AGE_MS : MAL_HIT_MAX_AGE_MS;
  return Date.now() - record.fetchedAt < maxAge ? record : null;
}

function searchQueries(title) {
  const queries = [title];
  const parts = title.split(/\s*[:–—-]\s*/).map((part) => part.trim()).filter((part) => part.length >= 8);
  if (parts.length > 1) queries.push(parts[parts.length - 1]);
  return [...new Set(queries)].slice(0, 2);
}

function hitFromRow(row) {
  return {
    malId: row.mal_id ?? null,
    score: typeof row.score === "number" ? row.score : null,
    title: typeof row.title === "string" ? row.title : "",
    titleEnglish: typeof row.title_english === "string" ? row.title_english : null,
  };
}

async function fetchHits(title) {
  const url = new URL("https://api.tenrai.org/v1/anime");
  url.searchParams.set("q", title);
  url.searchParams.set("limit", "5");
  const response = await fetch(url);
  if (!response.ok) return null;
  const body = await response.json();
  return Array.isArray(body?.data) ? body.data : [];
}
