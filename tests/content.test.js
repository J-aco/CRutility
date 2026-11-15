import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.style = {};
    this.textContent = "";
  }

  get nextElementSibling() {
    const siblings = this.parentElement?.children || [];
    return siblings[siblings.indexOf(this) + 1] || null;
  }

  append(child) {
    child.remove();
    this.children.push(child);
    child.parentElement = this;
  }

  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }

  insertAdjacentElement(position, child) {
    assert.equal(position, "afterend");
    child.remove();
    const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this) + 1, 0, child);
    child.parentElement = this.parentElement;
  }

  setAttribute(name, value) { this[name] = value; }
  querySelectorAll() { return []; }
}

function content({ url = "https://www.crunchyroll.com/series/GY8DWQN5Y/naruto", reply, initialized = false } = {}) {
  const root = new Element("html");
  const body = new Element("body");
  const heading = new Element("h1");
  heading.textContent = "Naruto";
  root.append(body);
  body.append(heading);
  const messages = [];
  let poll;
  let pageChanged;
  let ratings = null;
  let watchHeader = null;
  let seriesUrls = ["https://www.crunchyroll.com/series/GY8DWQN5Y/naruto"];
  const media = new Element("div");
  media.querySelectorAll = () => seriesUrls.map((href) => ({ href, textContent: "Unrelated link text" }));

  function find(node, predicate) {
    if (predicate(node)) return node;
    for (const child of node.children) {
      const match = find(child, predicate);
      if (match) return match;
    }
    return null;
  }

  const sandbox = {
    URL,
    location: new URL(url),
    setInterval(callback) { poll = callback; },
    chrome: {
      storage: {
        local: { get: () => initialized ? Promise.resolve({}) : new Promise(() => {}) },
        onChanged: { addListener() {} },
      },
      runtime: {
        onMessage: { addListener(callback) { pageChanged = callback; } },
        async sendMessage(message) {
        messages.push(message);
        return reply ? reply(message) : { malId: 1, score: 8.21 };
      } },
    },
    document: {
      documentElement: root,
      body,
      title: "Naruto - Crunchyroll",
      addEventListener() {},
      getElementById() { return null; },
      createElement: (tagName) => new Element(tagName),
      querySelector(selector) {
        if (selector === "div.erc-ratings") return ratings;
        if (selector === "#content .erc-watch-episode .current-media-wrapper") return media;
        if (selector.includes(".current-media-header")) return watchHeader;
        if (selector === "a[data-cr-mal]") return find(root, (node) => node.dataset.crMal === "1");
        if (selector === "[data-cr-tool-holder]") return find(root, (node) => node.dataset.crToolHolder === "1");
        if (selector === "[data-cr-tools]") return find(root, (node) => node.dataset.crTools === "1");
        return null;
      },
      querySelectorAll(selector) { return selector === "h1" ? [heading] : []; },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL("../src/shared/features.js", import.meta.url), "utf8"), sandbox);
  vm.runInContext(readFileSync(new URL("../src/content/content.js", import.meta.url), "utf8"), sandbox);
  return {
    sandbox, messages, body, heading,
    setSeriesUrls(urls) { seriesUrls = urls; },
    poll() { poll(); },
    pageChanged(url) { pageChanged({ type: "mal-page-change", pageUrl: url }); },
    get link() { return sandbox.document.querySelector("a[data-cr-mal]"); },
    addRatings() {
      ratings = new Element("div");
      body.append(ratings);
      return ratings;
    },
    addWatchHeader() {
      watchHeader = new Element("div");
      body.append(watchHeader);
      return watchHeader;
    },
  };
}

function skipPlayer({ label = "Skip Preview", fraction = 0.9, paused = false, className = "" } = {}) {
  const app = content({ url: "https://www.crunchyroll.com/watch/episode" });
  const video = { duration: 1000, currentTime: fraction * 1000, paused, dispatchEvent() {} };
  const button = (attributes) => ({
    clicks: 0,
    isConnected: true,
    getAttribute(name) { return attributes[name] ?? null; },
    querySelector() { return {}; },
    checkVisibility() { return true; },
    click() { this.clicks += 1; },
  });
  const skip = button({ "aria-label": label, class: className });
  const next = button({ "aria-label": "Next episode", "data-testid": "next-episode-button" });
  const querySelector = app.sandbox.document.querySelector;
  app.sandbox.document.querySelector = (selector) => {
    if (selector === "video") return video;
    if (selector === 'button[aria-label="Next episode"][data-testid="next-episode-button"]') return app.next;
    return querySelector(selector);
  };
  app.sandbox.document.querySelectorAll = (selector) => {
    if (selector === "video") return [video];
    if (selector === 'button:has(svg[data-testid="skip-intro-icon"])') return [skip];
    return [];
  };
  app.sandbox.MouseEvent = class {};
  app.sandbox.PointerEvent = class {};
  return Object.assign(app, { video, skip, next });
}

test("preview skipping clicks next episode once per episode without clicking skip", () => {
  const app = skipPlayer();
  app.sandbox.scanSkip();
  app.sandbox.scanSkip();
  assert.equal(app.next.clicks, 1);
  assert.equal(app.skip.clicks, 0);
  app.sandbox.location = new URL("https://www.crunchyroll.com/watch/next");
  app.sandbox.scanSkip();
  assert.equal(app.next.clicks, 2);
});

test("disabled preview skipping leaves both controls untouched", () => {
  const app = skipPlayer();
  vm.runInContext("settings.preview = false", app.sandbox);
  app.sandbox.scanSkip();
  assert.equal(app.next.clicks, 0);
  assert.equal(app.skip.clicks, 0);
});

test("preview skipping waits for an offered preview during playback after 80 percent", () => {
  for (const options of [
    { paused: true },
    { fraction: 0.8 },
    { className: "kat:opacity-0" },
    { label: "Next episode" },
  ]) {
    const app = skipPlayer(options);
    app.sandbox.scanSkip();
    assert.equal(app.next.clicks, 0);
    assert.equal(app.skip.clicks, 0);
  }
});

test("other skip kinds continue clicking their skip controls", () => {
  for (const options of [
    { label: "Skip Intro", fraction: 0.1 },
    { label: "Skip Credits" },
    { label: "Skip Recap", fraction: 0.05 },
  ]) {
    const app = skipPlayer(options);
    app.sandbox.scanSkip();
    assert.equal(app.skip.clicks, 1);
    assert.equal(app.next.clicks, 0);
  }
});

test("MAL title extraction and messaging never run on unrelated pages", async () => {
  for (const url of [
    "https://www.crunchyroll.com/",
    "https://www.crunchyroll.com/browse/anime",
    "https://www.crunchyroll.com/news/series/naruto",
    "https://www.crunchyroll.com/?next=/series/naruto",
    "https://example.com/watch/episode",
  ]) {
    const app = content({ url });
    vm.runInContext('showTitle = () => { throw new Error("Unrelated page title read"); }', app.sandbox);
    await app.sandbox.passSeries("series");
    await app.sandbox.passSeries("watch");
    assert.equal(app.messages.length, 0, url);
  }
});

test("series MAL button is inserted immediately after the ratings div", async () => {
  const app = content();
  const ratings = app.addRatings();
  await app.sandbox.passSeries("series");
  assert.equal(app.messages.length, 1);
  assert.equal(app.messages[0].pageUrl, app.sandbox.location.href);
  assert.equal(ratings.nextElementSibling, app.link);
  assert.equal(app.link.style.position, "static");
  assert.equal(app.link.textContent, "MAL 8.21");
  await app.sandbox.passSeries("series");
  assert.equal(app.messages.length, 1);
});

test("series button waits for ratings to render without repeating the lookup", async () => {
  const app = content();
  await app.sandbox.passSeries("series");
  assert.equal(app.link.parentElement.hidden, true);
  const ratings = app.addRatings();
  app.sandbox.placePageTools("series");
  assert.equal(ratings.nextElementSibling, app.link);
  assert.equal(app.messages.length, 1);
});

test("watch-page MAL button remains in the row after the episode header", async () => {
  const app = content({ url: "https://www.crunchyroll.com/watch/episode" });
  const header = app.addWatchHeader();
  await app.sandbox.passSeries("watch");
  assert.equal(header.nextElementSibling.dataset.crTools, "1");
  assert.equal(app.link.parentElement, header.nextElementSibling);
  assert.equal(app.link.style.position, "static");
});

test("MAL results arriving after navigation off the series page are discarded", async () => {
  let finish;
  const app = content({ reply: () => new Promise((resolve) => { finish = resolve; }) });
  const pending = app.sandbox.passSeries("series");
  app.sandbox.location = new URL("https://www.crunchyroll.com/");
  finish({ malId: 1, score: 8.21 });
  await pending;
  assert.equal(app.link, null);
});

test("a stale series lookup cannot replace a newer page's MAL button", async () => {
  const replies = [];
  const app = content({ reply: () => new Promise((resolve) => replies.push(resolve)) });
  const ratings = app.addRatings();
  const first = app.sandbox.passSeries("series");
  app.sandbox.location = new URL("https://www.crunchyroll.com/series/GY8DWQN5Y/bleach");
  const second = app.sandbox.passSeries("series");
  replies[1]({ malId: 2, score: 9.12 });
  await second;
  replies[0]({ malId: 1, score: 8.21 });
  await first;
  assert.equal(app.link.href, "https://myanimelist.net/anime/2");
  assert.equal(ratings.nextElementSibling, app.link);
});

test("series lookups use the URL slug without reading tab titles or page headings", async () => {
  const app = content({ url: "https://www.crunchyroll.com/series/GY8DWQN5Y/golden-kamuy" });
  app.heading.textContent = "Unrelated navigation heading";
  Object.defineProperty(app.sandbox.document, "title", { get() { throw new Error("Tab title read"); } });
  await app.sandbox.passSeries("series");
  assert.equal(app.messages.length, 1);
  assert.equal(app.messages[0].title, "golden kamuy");
});

test("a missing or placeholder series slug is discarded until a valid slug is available", async () => {
  const app = content();
  for (const path of ["/series/GY8DWQN5Y", "/series/GY8DWQN5Y/", "/series/GY8DWQN5Y/watch-popular-anime"]) {
    app.sandbox.location = new URL(path, "https://www.crunchyroll.com");
    await app.sandbox.passSeries("series");
    assert.equal(app.messages.length, 0);
  }
  app.sandbox.location = new URL("https://www.crunchyroll.com/series/GY8DWQN5Y/golden-kamuy");
  await app.sandbox.passSeries("series");
  assert.equal(app.messages.length, 1);
  assert.equal(app.messages[0].title, "golden kamuy");
});

test("a new series URL is retried immediately without inheriting the previous title's delay", async () => {
  const app = content({ reply: (message) => message.title === "naruto" ? null : { malId: 36028, score: 8.3 } });
  app.addRatings();
  await app.sandbox.passSeries("series");
  app.sandbox.location = new URL("https://www.crunchyroll.com/series/GY8DWQN5Y/golden-kamuy");
  await app.sandbox.passSeries("series");
  assert.equal(app.messages.length, 2);
  assert.equal(app.link.href, "https://myanimelist.net/anime/36028");
});

test("discarded page transitions do not trigger the failed-lookup timeout", async () => {
  let attempts = 0;
  const app = content({ reply: () => ++attempts === 1 ? { retry: true } : { malId: 36028, score: 8.3 } });
  await app.sandbox.passSeries("series");
  await app.sandbox.passSeries("series");
  assert.equal(app.messages.length, 2);
  assert.equal(app.link.href, "https://myanimelist.net/anime/36028");
});

test("the initialized poll uses the series slug immediately while the page title is still a placeholder", async () => {
  const app = content({ initialized: true, url: "https://www.crunchyroll.com/" });
  app.heading.textContent = "Watch Popular Anime";
  app.sandbox.document.title = "Watch Popular Anime | Crunchyroll";
  await new Promise((resolve) => setImmediate(resolve));
  app.sandbox.location = new URL("https://www.crunchyroll.com/series/GY8DWQN5Y/golden-kamuy");
  app.addRatings();
  app.poll();
  await new Promise((resolve) => setImmediate(resolve));
  app.poll();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.messages.length, 1);
  assert.equal(app.messages[0].title, "golden kamuy");
  assert.ok(app.link);
});

test("page-change notifications clear a previous miss and immediately retry the current page", async () => {
  let attempts = 0;
  const app = content({ initialized: true, reply: () => ++attempts === 1 ? { retry: true } : { malId: 1, score: 8.21 } });
  await new Promise((resolve) => setImmediate(resolve));
  app.pageChanged(app.sandbox.location.href);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.messages.length, 2);
  assert.ok(app.link);
});

test("a stale pending reply cannot block a newly visited series URL", async () => {
  let finishOld;
  const app = content({ reply: (message) => message.title === "naruto"
    ? new Promise((resolve) => { finishOld = resolve; })
    : { malId: 36028, score: 8.3 } });
  const pending = app.sandbox.passSeries("series");
  app.sandbox.location = new URL("https://www.crunchyroll.com/series/GY8DWQN5Y/golden-kamuy");
  await app.sandbox.passSeries("series");
  assert.equal(app.messages.length, 2);
  assert.equal(app.link.href, "https://myanimelist.net/anime/36028");
  finishOld({ malId: 1, score: 8.21 });
  await pending;
  assert.equal(app.link.href, "https://myanimelist.net/anime/36028");
});

test("an unanswered content message can be retried instead of staying pending forever", async () => {
  let finishOld;
  let attempts = 0;
  const app = content({ reply: () => ++attempts === 1
    ? new Promise((resolve) => { finishOld = resolve; })
    : { malId: 1, score: 8.21 } });
  const pending = app.sandbox.passSeries("series");
  vm.runInContext("seriesState.startedAt = Date.now() - 21000", app.sandbox);
  await app.sandbox.passSeries("series");
  assert.equal(app.messages.length, 2);
  assert.ok(app.link);
  finishOld(null);
  await pending;
  assert.ok(app.link);
});

test("series slug decoding ignores query strings, fragments, and trailing slashes", async () => {
  for (const [url, expected] of [
    ["https://www.crunchyroll.com/series/GY8DWQN5Y/golden-kamuy/?source=Watch%20Popular%20Anime#episodes", "golden kamuy"],
    ["https://crunchyroll.com/series/GY8DWQN5Y/dragon-ball-z", "dragon ball z"],
    ["https://www.crunchyroll.com/series/GY8DWQN5Y/%E7%8C%AB-and-dogs", "猫 and dogs"],
  ]) {
    const app = content({ url });
    await app.sandbox.passSeries("series");
    assert.equal(app.messages[0].title, expected);
  }
});

test("invalid series slug paths never fall back to unrelated page text", async () => {
  for (const path of [
    "/series/GY8DWQN5Y/%invalid",
    "/series/GY8DWQN5Y/other%2Fname",
    "/series/GY8DWQN5Y/golden-kamuy/episodes",
  ]) {
    const app = content({ url: `https://www.crunchyroll.com${path}` });
    await app.sandbox.passSeries("series");
    assert.equal(app.messages.length, 0);
  }
});

test("watch lookups use the current episode's linked series URL rather than episode or link text", async () => {
  const app = content({ url: "https://www.crunchyroll.com/watch/EPISODE/the-name-of-an-episode" });
  app.setSeriesUrls(["https://www.crunchyroll.com/series/GY8DWQN5Y/golden-kamuy"]);
  app.heading.textContent = "An episode heading";
  app.sandbox.document.title = "Watch Popular Anime | Crunchyroll";
  await app.sandbox.passSeries("watch");
  assert.equal(app.messages.length, 1);
  assert.equal(app.messages[0].title, "golden kamuy");
});

test("watch pages wait for the current series URL and ignore recommendation links", async () => {
  const app = content({ url: "https://www.crunchyroll.com/watch/EPISODE/an-episode-title" });
  app.setSeriesUrls([]);
  app.body.querySelectorAll = () => [{ href: "https://www.crunchyroll.com/series/OTHER/another-anime", textContent: "Another anime" }];
  await app.sandbox.passSeries("watch");
  assert.equal(app.messages.length, 0);
  app.setSeriesUrls(["https://www.crunchyroll.com/series/GY8DWQN5Y/golden-kamuy"]);
  await app.sandbox.passSeries("watch");
  assert.equal(app.messages.length, 1);
  assert.equal(app.messages[0].title, "golden kamuy");
});

test("changing page text does not send additional titles for the same series URL", async () => {
  const app = content();
  await app.sandbox.passSeries("series");
  app.heading.textContent = "A random heading";
  app.sandbox.document.title = "Another random title";
  await app.sandbox.passSeries("series");
  assert.equal(app.messages.length, 1);
  assert.equal(app.messages[0].title, "naruto");
});
