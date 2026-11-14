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

function content({ url = "https://www.crunchyroll.com/series/naruto", reply } = {}) {
  const root = new Element("html");
  const body = new Element("body");
  const heading = new Element("h1");
  heading.textContent = "Naruto";
  root.append(body);
  body.append(heading);
  const messages = [];
  let ratings = null;
  let watchHeader = null;

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
    chrome: {
      storage: { local: { get: () => new Promise(() => {}) } },
      runtime: { async sendMessage(message) {
        messages.push(message);
        return reply ? reply(message) : { malId: 1, score: 8.21 };
      } },
    },
    document: {
      documentElement: root,
      body,
      title: "Naruto - Crunchyroll",
      createElement: (tagName) => new Element(tagName),
      querySelector(selector) {
        if (selector === "div.erc-ratings") return ratings;
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
  app.sandbox.location = new URL("https://www.crunchyroll.com/series/bleach");
  const second = app.sandbox.passSeries("series");
  replies[1]({ malId: 2, score: 9.12 });
  await second;
  replies[0]({ malId: 1, score: 8.21 });
  await first;
  assert.equal(app.link.href, "https://myanimelist.net/anime/2");
  assert.equal(ratings.nextElementSibling, app.link);
});

test("placeholder titles are discarded until the real anime title appears", async () => {
  for (const kind of ["series", "watch"]) {
    const app = content({ url: `https://www.crunchyroll.com/${kind}/naruto` });
    for (const title of [
      "Watch Popular Anime | Crunchyroll",
      "Crunchyroll - WATCH POPULAR ANIME online",
      "Watch  Popular\nAnime",
    ]) {
      app.heading.textContent = title;
      app.sandbox.document.title = title;
      await app.sandbox.passSeries(kind);
      assert.equal(app.messages.length, 0);
      assert.equal(vm.runInContext("seriesState.status", app.sandbox), "");
    }
    app.heading.textContent = "Naruto";
    app.sandbox.document.title = "Naruto - Crunchyroll";
    await app.sandbox.passSeries(kind);
    assert.equal(app.messages.length, 1);
    assert.equal(app.messages[0].title, "Naruto");
  }
});
