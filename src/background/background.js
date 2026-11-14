/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (C) 2026 Fred and contributors. Upstream portions retain their owners' rights.
 * Modified work; compliance changes dated 2026-11-14. See ../../docs/THIRD_PARTY_NOTICES.md.
 * Distributed without warranty; see ../../LICENSE for the full terms.
 */
importScripts("../shared/features.js");

const MAL_CACHE_KEY = "malCache";
const MAL_HIT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAL_MISS_MAX_AGE_MS = 15 * 60 * 1000;
const TENRAI_ACCESS_KEY = "tenraiAccess";
// Below Tenrai's public limits of 4 requests/second and 120/minute.
// Persist spacing and server backoff across service-worker restarts.
const TENRAI_REQUEST_INTERVAL_MS = 550;
const pendingLookups = new Map();
let lookupQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "mal-lookup" || typeof message.title !== "string") return;
  const page = malLookupPage(sender, message.pageUrl);
  if (!page) {
    sendResponse(null);
    return false;
  }
  queuedLookup(message.title, page).then(sendResponse, () => sendResponse(null));
  return true;
});

function malLookupPage(sender, pageUrl) {
  if (sender.frameId !== 0 || !Number.isInteger(sender.tab?.id) || malPageKind(pageUrl) === "other") return null;
  try {
    if (new URL(sender.url).origin !== new URL(pageUrl).origin) return null;
    return { tabId: sender.tab.id, url: pageUrl };
  } catch {
    return null;
  }
}

function queuedLookup(title, page) {
  const key = title.trim();
  if (!key || key.length > 300 || /watch\s+popular\s+anime/i.test(key)) return Promise.resolve(null);
  const pendingKey = JSON.stringify([page.tabId, page.url, key]);
  if (pendingLookups.has(pendingKey)) return pendingLookups.get(pendingKey);
  const lookup = lookupQueue.then(() => lookupMal(key, page));
  lookupQueue = lookup.catch(() => {});
  pendingLookups.set(pendingKey, lookup);
  const clear = () => pendingLookups.delete(pendingKey);
  lookup.then(clear, clear);
  return lookup;
}

async function lookupMal(title, page) {
  const key = title.trim();
  if (!key) return null;
  const stored = await chrome.storage.local.get([MAL_CACHE_KEY, "mal"]);
  if (stored.mal === false) return null;
  const cache = stored[MAL_CACHE_KEY] && typeof stored[MAL_CACHE_KEY] === "object"
    ? stored[MAL_CACHE_KEY]
    : {};
  const cached = freshRecord(cache[key]);
  if (cached) return cached;

  const hits = [];
  for (const query of searchQueries(key)) {
    // Stop on errors, including 429, instead of trying another query.
    const rows = await fetchHits(query, page);
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

async function fetchHits(title, page) {
  const stored = await chrome.storage.local.get(TENRAI_ACCESS_KEY);
  const access = stored[TENRAI_ACCESS_KEY] || {};
  if (Date.now() < (access.retryAt || 0)) throw new Error("Tenrai requests paused");
  const wait = Math.max(0, (access.nextRequestAt || 0) - Date.now());
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  const tab = await chrome.tabs.get(page.tabId);
  if (tab.url !== page.url || malPageKind(tab.url) === "other") throw new Error("MAL lookup page changed");
  const settings = await chrome.storage.local.get("mal");
  if (settings.mal === false) throw new Error("MAL lookup disabled");
  await chrome.storage.local.set({
    [TENRAI_ACCESS_KEY]: { nextRequestAt: Date.now() + TENRAI_REQUEST_INTERVAL_MS },
  });
  const url = new URL("https://api.tenrai.org/v1/anime");
  url.searchParams.set("q", title);
  url.searchParams.set("limit", "5");
  const response = await fetch(url, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 429 || response.status === 403) {
    const retryAfter = response.headers.get("Retry-After");
    const seconds = retryAfter?.trim() ? Number(retryAfter) : NaN;
    const retryAt = Number.isFinite(seconds)
      ? Date.now() + Math.max(0, seconds) * 1000
      : Date.parse(retryAfter);
    const fallback = response.status === 403 ? 24 * 60 * 60 * 1000 : 60000;
    await chrome.storage.local.set({
      [TENRAI_ACCESS_KEY]: {
        nextRequestAt: Date.now() + TENRAI_REQUEST_INTERVAL_MS,
        retryAt: Math.max(Date.now() + fallback, Number.isFinite(retryAt) ? retryAt : 0),
      },
    });
  }
  if (!response.ok) throw new Error(`Tenrai returned ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body?.data)) throw new Error("Invalid Tenrai response");
  return body.data;
}
