import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(readFileSync(new URL("./features.js", import.meta.url), "utf8"), sandbox);
const { classifySkip, pickMalHit, skipControlOffered, reduceFill } = sandbox.crunchyrollTools;

test("intro", () => {
  assert.equal(classifySkip("Skip Intro", 0.12, true), "intro");
  assert.equal(classifySkip("SKIP INTRO", 0.2, false), "intro");
});

test("recap", () => {
  assert.equal(classifySkip("SKIP RECAP", 0.05, true), "recap");
});

test("credits", () => {
  assert.equal(classifySkip("Skip Credits", 0.9, true), "outro");
});

test("promo in the first half", () => {
  assert.equal(classifySkip("Skip", 0.1, true), "promo");
  assert.equal(classifySkip("Skip Promo", 0.2, false), "promo");
});

test("exact Skip with the icon is a promo after the halfway point", () => {
  assert.equal(classifySkip("Skip", 0.8, true), "promo");
});

test("preview in the second half is rejected", () => {
  assert.equal(classifySkip("Skip Preview", 0.9, true), null);
});

test("promo Skip is offered when aria-hidden is false in the first 5 seconds", () => {
  assert.equal(skipControlOffered({ ariaHidden: "false", currentTime: 0 }, "promo"), true);
  assert.equal(skipControlOffered({ ariaHidden: "false", currentTime: 5 }, "promo"), true);
  assert.equal(skipControlOffered({ ariaHidden: "false", currentTime: 5.1 }, "promo"), false);
  assert.equal(skipControlOffered({ ariaHidden: "true", currentTime: 1 }, "promo"), false);
});

test("an intro control with opacity-0 is not offered", () => {
  assert.equal(skipControlOffered("kat:opacity-0", "intro"), false);
  assert.equal(skipControlOffered("kat:pointer-events-auto", "intro"), true);
});

test("Skip and Loafer is rejected", () => {
  assert.equal(classifySkip("Skip and Loafer", 0.1, true), null);
  assert.equal(classifySkip("Skip and Loafer", 0.1, false), null);
});

test("bare Skip without the icon is rejected", () => {
  assert.equal(classifySkip("Skip", 0.1, false), null);
});

test("a movie subtitle beats the shorter series title", () => {
  const hits = [
    {
      malId: 38000,
      title: "Kimetsu no Yaiba",
      titleEnglish: "Demon Slayer: Kimetsu no Yaiba",
      score: 8.43,
    },
    {
      malId: 58514,
      title: "Kimetsu no Yaiba Movie: Mugenjou-hen",
      titleEnglish: "Demon Slayer: Kimetsu no Yaiba Infinity Castle",
      score: 8.21,
    },
  ];
  const movie = pickMalHit("Demon Slayer: Kimetsu no Yaiba Infinity Castle", hits);
  assert.equal(movie.malId, 58514);
});

test("fill toggle", () => {
  const off = reduceFill(
    { href: "", expanded: false, showButton: false },
    { type: "tick", pageKind: "series", href: "https://www.crunchyroll.com/series/x", enabled: true },
  );
  assert.equal(off.href, "https://www.crunchyroll.com/series/x");
  assert.equal(off.expanded, false);
  assert.equal(off.showButton, false);
  const armed = reduceFill(off, {
    type: "tick",
    pageKind: "watch",
    href: "https://www.crunchyroll.com/watch/abc",
    enabled: true,
  });
  assert.equal(armed.showButton, true);
  assert.equal(armed.expanded, true);
  const exited = reduceFill(armed, { type: "toggle" });
  assert.equal(exited.expanded, false);
  const stayed = reduceFill(exited, {
    type: "tick",
    pageKind: "watch",
    href: "https://www.crunchyroll.com/watch/abc",
    enabled: true,
  });
  assert.equal(stayed.expanded, false);
  const filled = reduceFill(stayed, { type: "toggle" });
  assert.equal(filled.expanded, true);
  const left = reduceFill(filled, {
    type: "tick",
    pageKind: "watch",
    href: "https://www.crunchyroll.com/watch/next",
    enabled: true,
  });
  assert.equal(left.expanded, true);
  assert.equal(left.showButton, true);
  const disabled = reduceFill(filled, { type: "disable" });
  assert.equal(disabled.href, "");
  assert.equal(disabled.expanded, false);
  assert.equal(disabled.showButton, false);
});

test("title pick", () => {
  const hits = [
    {
      malId: 16498,
      title: "Shingeki no Kyojin",
      titleEnglish: "Attack on Titan",
      score: 8.55,
    },
    {
      malId: 1,
      title: "Cowboy Bebop",
      titleEnglish: "Cowboy Bebop",
      score: 8.75,
    },
  ];
  const picked = pickMalHit("Attack on Titan", hits);
  assert.equal(picked.malId, 16498);
  assert.equal(picked.score, 8.55);
});
