/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (C) 2026 Fred and contributors. See ../LICENSE and ../docs/THIRD_PARTY_NOTICES.md.
 * Added 2026-11-14 to verify Tenrai request limits and privacy behavior.
 * Distributed without warranty.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const workerUrl = new URL("../src/background/background.js", import.meta.url);
const workerSource = readFileSync(workerUrl, "utf8");

function response(status = 200, data = [], retryAfter = null) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => retryAfter },
    json: async () => ({ data }),
  };
}

function worker({ store = {}, clock = { now: 1800000000000 }, reply, pageUrl = "https://www.crunchyroll.com/series/naruto" } = {}) {
  const requests = [];
  const tab = { id: 1, url: pageUrl };
  let listener;
  const sandbox = {
    URL,
    AbortSignal,
    Date: class extends Date { static now() { return clock.now; } },
    setTimeout(callback, ms) { clock.now += ms; callback(); },
    chrome: {
      tabs: { async get(id) { assert.equal(id, tab.id); return { ...tab }; } },
      storage: { local: {
        async get(keys) {
          return Object.fromEntries([].concat(keys).map((key) => [key, structuredClone(store[key])]));
        },
        async set(values) { Object.assign(store, structuredClone(values)); },
      } },
      runtime: { onMessage: { addListener(fn) { listener = fn; } } },
    },
    async fetch(url, options) {
      requests.push({ url, options, at: clock.now });
      return reply ? reply(url, options) : response(200, [
        { mal_id: 1, title: url.searchParams.get("q"), score: 8.21 },
      ]);
    },
    importScripts(...paths) {
      for (const path of paths) {
        vm.runInContext(readFileSync(new URL(path, workerUrl), "utf8"), sandbox);
      }
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(workerSource, sandbox);
  return {
    requests, store, clock, tab,
    lookup(title, sender = { frameId: 0, url: tab.url, tab: { id: tab.id } }, sourceUrl = sender.url) {
      return new Promise((resolve) => {
        listener({ type: "mal-lookup", title, pageUrl: sourceUrl }, sender, resolve);
      });
    },
  };
}

test("simultaneous lookups share one request and reuse the cached match", async () => {
  const app = worker();
  const records = await Promise.all([app.lookup("Naruto"), app.lookup(" Naruto ")]);
  assert.equal(records[0].score, 8.21);
  assert.equal(records[1].malId, 1);
  await app.lookup("Naruto");
  assert.equal(app.requests.length, 1);
});

test("different tabs are paced below both public request limits and keep both cache entries", async () => {
  const app = worker();
  await Promise.all([app.lookup("Naruto"), app.lookup("Bleach"), app.lookup("One Piece")]);
  assert.equal(app.requests.length, 3);
  for (let i = 1; i < app.requests.length; i++) {
    assert.ok(app.requests[i].at - app.requests[i - 1].at >= 550);
  }
  assert.equal(Object.keys(app.store.malCache).length, 3);
});

test("request spacing survives a service-worker restart", async () => {
  const first = worker();
  await first.lookup("Naruto");
  const restarted = worker({ store: first.store, clock: first.clock });
  await restarted.lookup("Bleach");
  assert.ok(restarted.requests[0].at - first.requests[0].at >= 550);
});

test("429 stops alternate queries and preserves Retry-After across worker restarts", async () => {
  const first = worker({ reply: () => response(429, [], "180") });
  assert.equal(await first.lookup("Long Series Title: Alternate Title"), null);
  assert.equal(first.requests.length, 1);
  const restarted = worker({ store: first.store, clock: first.clock });
  restarted.clock.now += 60000;
  assert.equal(await restarted.lookup("Bleach"), null);
  assert.equal(restarted.requests.length, 0);
  restarted.clock.now += 120001;
  assert.equal((await restarted.lookup("Bleach")).malId, 1);
  assert.equal(restarted.requests.length, 1);
});

test("429 supports Retry-After as an HTTP date", async () => {
  const clock = { now: 1800000000000 };
  const retryAt = clock.now + 300000;
  const app = worker({ clock, reply: () => response(429, [], new Date(retryAt).toUTCString()) });
  await app.lookup("Naruto");
  assert.equal(app.store.tenraiAccess.retryAt, retryAt);
});

test("429 with missing or invalid Retry-After uses a one-minute minimum pause", async () => {
  for (const header of [null, "", "invalid", "0"]) {
    const app = worker({ reply: () => response(429, [], header) });
    await app.lookup("Naruto");
    assert.ok(app.store.tenraiAccess.retryAt >= app.clock.now + 60000);
    await app.lookup("Bleach");
    assert.equal(app.requests.length, 1);
  }
});

test("403 pauses public requests for at least 24 hours", async () => {
  const app = worker({ reply: () => response(403) });
  await app.lookup("Naruto");
  assert.equal(app.store.tenraiAccess.retryAt, app.clock.now + 24 * 60 * 60 * 1000);
  app.clock.now += 60 * 60 * 1000;
  await app.lookup("Bleach");
  assert.equal(app.requests.length, 1);
});

test("empty successful searches are cached for 15 minutes", async () => {
  const app = worker({ reply: () => response() });
  assert.equal((await app.lookup("Unknown Series")).malId, null);
  await app.lookup("Unknown Series");
  assert.equal(app.requests.length, 1);
  app.clock.now += 15 * 60 * 1000;
  await app.lookup("Unknown Series");
  assert.equal(app.requests.length, 2);
});

test("successful matches are refreshed after seven days", async () => {
  const app = worker();
  await app.lookup("Naruto");
  app.clock.now += 7 * 24 * 60 * 60 * 1000;
  await app.lookup("Naruto");
  assert.equal(app.requests.length, 2);
});

test("cached scores remain available during a server cooldown", async () => {
  const app = worker();
  await app.lookup("Naruto");
  app.store.tenraiAccess.retryAt = app.clock.now + 60000;
  assert.equal((await app.lookup("Naruto")).score, 8.21);
  assert.equal(app.requests.length, 1);
});

test("disabled ratings and oversized queries do not make requests", async () => {
  const app = worker({ store: { mal: false } });
  assert.equal(await app.lookup("Naruto"), null);
  app.store.mal = true;
  assert.equal(await app.lookup("x".repeat(301)), null);
  assert.equal(await app.lookup(" "), null);
  assert.equal(app.requests.length, 0);
});

test("public requests omit credentials and referrers and only send search parameters", async () => {
  const app = worker();
  await app.lookup("Naruto");
  const { url, options } = app.requests[0];
  assert.equal(url.origin, "https://api.tenrai.org");
  assert.equal(url.pathname, "/v1/anime");
  assert.deepEqual([...url.searchParams], [["q", "Naruto"], ["limit", "5"]]);
  assert.equal(options.credentials, "omit");
  assert.equal(options.referrerPolicy, "no-referrer");
  assert.equal(options.headers, undefined);
});

test("network or server failures stop fallback queries without caching a false miss", async () => {
  for (const reply of [() => response(503), () => { throw new Error("Offline"); }]) {
    const app = worker({ reply });
    assert.equal(await app.lookup("Long Series Title: Alternate Title"), null);
    assert.equal(app.requests.length, 1);
    assert.equal(app.store.malCache, undefined);
  }
});

test("only series and watch URLs on Crunchyroll can start a MAL request", async () => {
  for (const pageUrl of [
    "https://www.crunchyroll.com/series/naruto",
    "https://crunchyroll.com/watch/episode/title?lang=en#player",
  ]) {
    const app = worker({ pageUrl });
    assert.equal((await app.lookup("Naruto")).malId, 1);
    assert.equal(app.requests.length, 1);
  }
  for (const pageUrl of [
    "https://www.crunchyroll.com/",
    "https://www.crunchyroll.com/browse/anime",
    "https://www.crunchyroll.com/news/series/naruto",
    "https://www.crunchyroll.com/?next=/watch/episode",
    "https://www.crunchyroll.com/series/",
    "https://www.crunchyroll.com/watch/",
    "https://www.crunchyroll.com/series-other/naruto",
    "https://example.com/series/naruto",
    "https://www.crunchyroll.com.example.com/series/naruto",
    "http://www.crunchyroll.com/series/naruto",
  ]) {
    const app = worker({ pageUrl });
    assert.equal(await app.lookup("Naruto"), null, pageUrl);
    assert.equal(app.requests.length, 0, pageUrl);
  }
});

test("MAL requests from frames or with a mismatched page URL are rejected", async () => {
  const app = worker();
  const sender = { frameId: 0, url: app.tab.url, tab: { id: app.tab.id } };
  assert.equal(await app.lookup("Naruto", { ...sender, frameId: 1 }), null);
  assert.equal(await app.lookup("Naruto", sender, "https://www.crunchyroll.com/watch/other"), null);
  assert.equal(await app.lookup("Naruto", sender, null), null);
  assert.equal(await app.lookup("Naruto", { ...sender, tab: undefined }), null);
  assert.equal(app.requests.length, 0);
});

test("queued MAL requests are discarded when their tab leaves the requesting page", async () => {
  let started;
  let finish;
  const fetching = new Promise((resolve) => { started = resolve; });
  const app = worker({ reply: () => {
    started();
    return new Promise((resolve) => { finish = resolve; });
  } });
  const first = app.lookup("Naruto");
  const queued = app.lookup("Bleach");
  await fetching;
  app.tab.url = "https://www.crunchyroll.com/";
  finish(response(200, [{ mal_id: 1, title: "Naruto", score: 8.21 }]));
  await first;
  assert.equal(await queued, null);
  assert.equal(app.requests.length, 1);
});

test("a sender URL cannot start a request after the tab has navigated elsewhere", async () => {
  const app = worker();
  const sender = { frameId: 0, url: app.tab.url, tab: { id: app.tab.id } };
  app.tab.url = "https://www.crunchyroll.com/series/bleach";
  assert.equal(await app.lookup("Naruto", sender), null);
  assert.equal(app.requests.length, 0);
});

test("placeholder titles never reach Tenrai or create a cached miss", async () => {
  const app = worker();
  for (const title of [
    "Watch Popular Anime | Crunchyroll",
    "Crunchyroll - WATCH POPULAR ANIME online",
    "Watch  Popular\nAnime",
  ]) {
    assert.equal(await app.lookup(title), null);
  }
  assert.equal(app.requests.length, 0);
  assert.equal(app.store.malCache, undefined);
  assert.equal((await app.lookup("Naruto")).malId, 1);
  assert.equal(app.requests.length, 1);
});

test("navigation from the home page to a series uses the current tab URL", async () => {
  const app = worker();
  const sender = { frameId: 0, url: "https://www.crunchyroll.com/", tab: { id: app.tab.id } };
  assert.equal((await app.lookup("Naruto", sender, app.tab.url))?.malId, 1);
  assert.equal(app.requests.length, 1);
});

test("navigation from a series to an episode accepts the current watch URL", async () => {
  const app = worker({ pageUrl: "https://www.crunchyroll.com/watch/episode" });
  const sender = { frameId: 0, url: "https://www.crunchyroll.com/series/naruto", tab: { id: app.tab.id } };
  assert.equal((await app.lookup("Naruto", sender, app.tab.url))?.malId, 1);
  assert.equal(app.requests.length, 1);
});

test("a current-page URL cannot be supplied by a different origin", async () => {
  const app = worker();
  const sender = { frameId: 0, url: "https://example.com/", tab: { id: app.tab.id } };
  assert.equal(await app.lookup("Naruto", sender, app.tab.url), null);
  assert.equal(app.requests.length, 0);
});
