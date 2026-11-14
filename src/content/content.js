/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (C) 2026 Fred and contributors. Upstream portions retain their owners' rights.
 * Modified work; compliance changes dated 2026-11-14. See ../../docs/THIRD_PARTY_NOTICES.md.
 * Distributed without warranty; see ../../LICENSE for the full terms.
 */
const LAST_PROFILE_KEY = "lastProfile";
const SCAN_MS = 500;

let settings = settingsFromStored(null);
let remembered = null;
let profileClicked = false;
let seriesState = { href: "", status: "" };
let fillModel = { href: "", expanded: false, showButton: false };
let parkedHeader = null;
let headerRecheck = 0;
let chromeFadeTimer = 0;
let chromeFaded = false;
const chromeFadeBound = new WeakSet();

const FILL_HEADER_CLASS = "app-layout__header";
const FILL_CSS = `.erc-watch-episode-layout .video-player-spacer {
    max-height: 95vh !important;
    height: 100vw !important;
    min-height: calc(20rem*.5625) !important;
}
`;

init();

async function init() {
  const stored = await chrome.storage.local.get([
    LAST_PROFILE_KEY,
    ...FEATURES.map((feature) => feature.id),
  ]);
  settings = settingsFromStored(stored);
  remembered = normalizeProfile(stored[LAST_PROFILE_KEY]);
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "mal-page-change" || message.pageUrl !== location.href) return;
    clearMal();
    seriesState = { href: "", status: "" };
    const kind = pageKind(location, document);
    if (kind === "series" || kind === "watch") passSeries(kind);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const feature of FEATURES) {
      if (!changes[feature.id]) continue;
      settings[feature.id] = changes[feature.id].newValue !== false;
    }
    if (changes.mal) {
      seriesState = { href: "", status: "" };
      if (changes.mal.newValue === false) clearMal();
    }
    if (changes.fill) {
      const kind = pageKind(location, document);
      fillModel = reduceFill(fillModel, changes.fill.newValue === false
        ? { type: "disable" }
        : { type: "tick", pageKind: kind, href: location.href, enabled: settings.fill === true });
      realizeFill(fillModel);
      placePageTools(kind);
    }
    if (changes[LAST_PROFILE_KEY]) remembered = normalizeProfile(changes[LAST_PROFILE_KEY].newValue);
  });
  document.addEventListener("click", onProfileClick, true);
  setInterval(tick, SCAN_MS);
  tick();
}

function tick() {
  const kind = pageKind(location, document);
  if (seriesState.href && seriesState.href !== location.href) {
    clearMal();
    seriesState = { href: "", status: "" };
  }
  if (kind === "series" || kind === "watch") passSeries(kind);
  syncFill(kind);
  try {
    if (settings.profile && kind !== "profile-gate") rememberHeaderAvatar();
    if (kind === "profile-gate") {
      selectProfileOnce();
      return;
    }
    if (kind !== "series" && kind !== "watch") {
      clearMal();
      return;
    }
    if (kind === "watch") scanSkip();
  } finally {
    placePageTools(kind);
  }
}

function revealPlayer() {
  const video = document.querySelector("video");
  const root = document.querySelector('[data-testid="player-controls-root"]') || video?.parentElement;
  for (const el of [root, video]) {
    if (!el) continue;
    for (const type of ["pointerenter", "pointerover", "mouseenter", "mouseover", "mousemove"]) {
      const EventType = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      el.dispatchEvent(new EventType(type, { bubbles: true, composed: true }));
    }
  }
}

function pageKind(url, doc) {
  const gate = [...doc.querySelectorAll(".erc-profile-item")].some(visible);
  if (gate) return "profile-gate";
  return malPageKind(url);
}

let promoClickedHref = "";

function scanSkip() {
  revealPlayer();
  const video = playbackVideo();
  const fraction = playbackFraction(video);
  const playing = Boolean(video) && !video.paused && video.currentTime > 2;
  for (const button of skipButtons()) {
    const label = accessibleName(button);
    const hasSkipIcon = Boolean(button.querySelector('svg[data-testid="skip-intro-icon"]'));
    const kind = classifySkip(label, fraction, hasSkipIcon);
    if (!kind) continue;
    const featureId = featureIdForKind(kind);
    if (!featureId || !settings[featureId]) continue;
    if (kind === "promo") {
      if (!video || video.paused) continue;
      if (promoClickedHref === location.href) continue;
      const offered = skipControlOffered({
        ariaHidden: button.getAttribute("aria-hidden"),
        currentTime: video.currentTime,
      }, "promo");
      if (!offered) continue;
      promoClickedHref = location.href;
      button.click();
      return;
    }
    if (!skipControlOffered(button.getAttribute("class"), kind)) continue;
    if (!visible(button)) continue;
    if (!playing) continue;
    button.click();
    return;
  }
}

function playbackVideo() {
  const videos = [...document.querySelectorAll("video")];
  const playing = videos.filter((video) => !video.paused && !video.ended);
  const pool = playing.length ? playing : videos;
  return pool.sort((left, right) => (Number(right.duration) || 0) - (Number(left.duration) || 0))[0] || null;
}

function skipButtons() {
  const found = new Set();
  for (const button of document.querySelectorAll('button:has(svg[data-testid="skip-intro-icon"])')) {
    found.add(button);
  }
  for (const node of document.querySelectorAll('[data-testid="skipIntroText"]')) {
    const button = node.closest("button");
    if (button) found.add(button);
  }
  return [...found];
}

function accessibleName(button) {
  const aria = button.getAttribute("aria-label");
  if (aria && aria.trim()) return aria.trim();
  return (button.textContent || "").replace(/\s+/g, " ").trim();
}

function playbackFraction(video) {
  if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return 0;
  if (!Number.isFinite(video.currentTime) || video.currentTime < 0) return 0;
  return video.currentTime / video.duration;
}

function onProfileClick(event) {
  const item = event.target.closest?.(".erc-profile-item");
  if (!item || !settings.profile) return;
  profileClicked = true;
  remembered = profileFromItem(item);
  chrome.storage.local.set({ [LAST_PROFILE_KEY]: remembered });
}

function selectProfileOnce() {
  if (profileClicked || !settings.profile || !remembered) return;
  const items = [...document.querySelectorAll(".erc-profile-item")].filter(visible);
  if (!items.length) return;
  const match = matchProfile(items, remembered);
  if (!match) return;
  profileClicked = true;
  const img = match.querySelector("img");
  if (img) img.click();
  else match.click();
}

function matchProfile(items, record) {
  if (record.avatarSrc) {
    const bySrc = items.find((item) => {
      const img = item.querySelector("img");
      return (img?.currentSrc || img?.src) === record.avatarSrc;
    });
    if (bySrc) return bySrc;
  }
  const wanted = (record.name || "").trim().toLowerCase();
  if (!wanted) return null;
  return items.find((item) => {
    const alt = item.querySelector("img")?.alt?.trim().toLowerCase() || "";
    return alt === wanted || itemName(item).toLowerCase() === wanted;
  }) || null;
}

function rememberHeaderAvatar() {
  const img = document.querySelector(".avatar-wrapper img");
  if (!img || !visible(img)) return;
  const avatarSrc = img.currentSrc || img.src;
  if (!avatarSrc) return;
  const next = {
    name: img.alt.trim() || remembered?.name || null,
    avatarSrc,
  };
  if (remembered && remembered.name === next.name && remembered.avatarSrc === next.avatarSrc) return;
  remembered = next;
  chrome.storage.local.set({ [LAST_PROFILE_KEY]: next });
}

async function passSeries(kind) {
  if (!settings.mal || !["series", "watch"].includes(kind) || pageKind(location, document) !== kind) return;
  const title = showTitle(kind);
  if (!title) return;
  if (seriesState.href !== location.href || seriesState.title !== title) {
    clearMal();
    seriesState = { href: location.href, title, status: "" };
  }
  if (document.querySelector("a[data-cr-mal]")) return;
  if (seriesState.status === "pending" && Date.now() - seriesState.startedAt < 20000) return;
  if (seriesState.href === location.href && seriesState.status === "miss" && Date.now() < seriesState.retryAt) return;
  const requestState = { href: location.href, title, status: "pending", startedAt: Date.now() };
  seriesState = requestState;
  let record = null;
  try {
    record = await chrome.runtime.sendMessage({ type: "mal-lookup", title, pageUrl: requestState.href });
  } catch {
    if (seriesState === requestState && location.href === requestState.href) {
      seriesState = { href: requestState.href, title, status: "miss", retryAt: Date.now() + 20000 };
    }
    return;
  }
  if (seriesState !== requestState || location.href !== requestState.href
    || !settings.mal || pageKind(location, document) !== kind) return;
  if (record?.retry) {
    seriesState = { href: requestState.href, title, status: "" };
    return;
  }
  if (!record || record.malId == null) {
    seriesState = { href: location.href, title, status: "miss", retryAt: Date.now() + 20000 };
    return;
  }
  seriesState = { href: location.href, title, status: "ok" };
  renderMal(record);
}

function showTitle(kind) {
  if (kind === "series") return seriesTitleFromUrl(location.href);
  if (kind !== "watch") return "";
  const media = document.querySelector("#content .erc-watch-episode .current-media-wrapper");
  if (!media) return "";
  for (const link of media.querySelectorAll('a[href*="/series/"]')) {
    const title = seriesTitleFromUrl(link.href);
    if (title) return title;
  }
  return "";
}

function seriesTitleFromUrl(value) {
  try {
    const url = new URL(value, location.href);
    if (malPageKind(url) !== "series") return "";
    const slug = url.pathname.match(/^\/series\/[^/]+\/([^/]+)\/?$/)?.[1];
    if (!slug) return "";
    const decoded = decodeURIComponent(slug);
    if (/[\/#?]/.test(decoded)) return "";
    return cleanShowTitle(decoded.replace(/[-_]+/g, " "));
  } catch {
    return "";
  }
}

function cleanShowTitle(value) {
  if (typeof value !== "string" || /watch\s+popular\s+anime/i.test(value)) return "";
  const title = value.replace(/\s+/g, " ").trim();
  if (title.length < 2) return "";
  if (/^(crunchyroll|home|watch|series|loading)$/i.test(title)) return "";
  return title;
}

function syncFill(kind) {
  fillModel = reduceFill(fillModel, {
    type: "tick",
    pageKind: kind,
    href: location.href,
    enabled: settings.fill === true,
  });
  realizeFill(fillModel);
}

function realizeFill(model) {
  if (model.expanded) {
    ensureFillStyle();
    parkHeader();
    armHeaderRecheck();
    armChromeFade();
    if (chromeFaded) fadeChrome();
  } else {
    disarmHeaderRecheck();
    clearChromeFade();
    document.getElementById("cr-fill-style")?.remove();
    restoreHeader();
  }
  if (!model.showButton) {
    document.querySelector("button[data-cr-fill]")?.remove();
    return;
  }
  const button = ensureFillButton();
  button.textContent = model.expanded ? "Exit fill" : "Fill page";
  button.setAttribute("aria-pressed", model.expanded ? "true" : "false");
}

function ensureFillStyle() {
  if (document.getElementById("cr-fill-style")) return;
  const style = document.createElement("style");
  style.id = "cr-fill-style";
  style.textContent = FILL_CSS;
  (document.head || document.documentElement).append(style);
}

function headerNode() {
  for (const el of document.querySelectorAll(`div[class*="${FILL_HEADER_CLASS}"]`)) {
    if ([...el.classList].some((name) => name.startsWith(FILL_HEADER_CLASS))) return el;
  }
  return null;
}

function parkHeader() {
  const header = headerNode();
  if (!header || !header.isConnected) return;
  if (parkedHeader?.node === header) return;
  detachHeader(header);
}

function armHeaderRecheck() {
  if (headerRecheck) return;
  headerRecheck = setTimeout(() => {
    headerRecheck = 0;
    if (!fillModel.expanded) return;
    detachHeader(headerNode());
  }, 2000);
}

function disarmHeaderRecheck() {
  if (!headerRecheck) return;
  clearTimeout(headerRecheck);
  headerRecheck = 0;
}

function chromeFadeNodes() {
  return document.querySelectorAll('div[class~="kat:transition-opacity"]');
}

function armChromeFade() {
  if (chromeFadeTimer || chromeFaded) return;
  chromeFadeTimer = setTimeout(() => {
    chromeFadeTimer = 0;
    if (!fillModel.expanded) return;
    chromeFaded = true;
    fadeChrome();
  }, 1000);
}

function fadeChrome() {
  for (const el of chromeFadeNodes()) {
    if (!chromeFadeBound.has(el)) {
      chromeFadeBound.add(el);
      el.addEventListener("mouseenter", () => {
        if (!fillModel.expanded || !chromeFaded) return;
        el.style.opacity = "1";
      });
      el.addEventListener("mouseleave", () => {
        if (!fillModel.expanded || !chromeFaded) return;
        el.style.opacity = "0";
      });
    }
    el.dataset.crFade = "1";
    if (!el.matches(":hover")) el.style.opacity = "0";
  }
}

function clearChromeFade() {
  if (chromeFadeTimer) {
    clearTimeout(chromeFadeTimer);
    chromeFadeTimer = 0;
  }
  chromeFaded = false;
  for (const el of document.querySelectorAll("[data-cr-fade]")) {
    el.style.opacity = "";
    delete el.dataset.crFade;
  }
}

function detachHeader(header) {
  if (!header || !header.isConnected) return;
  parkedHeader = {
    node: header,
    parent: header.parentNode,
    next: header.nextSibling,
  };
  header.remove();
}

function restoreHeader() {
  if (!parkedHeader) return;
  const { node, parent, next } = parkedHeader;
  parkedHeader = null;
  if (!parent || !parent.isConnected || node.isConnected) return;
  if (next && next.parentNode === parent) parent.insertBefore(node, next);
  else parent.append(node);
}

function ensureFillButton() {
  const existing = document.querySelector("button[data-cr-fill]");
  if (existing) return existing;
  const button = document.createElement("button");
  button.dataset.crFill = "1";
  button.type = "button";
  button.style.background = "#f47521";
  button.style.color = "#fff";
  button.style.border = "0";
  button.style.borderRadius = "4px";
  button.style.padding = "6px 10px";
  button.style.font = "700 14px/1.2 sans-serif";
  button.style.cursor = "pointer";
  button.addEventListener("click", () => {
    fillModel = reduceFill(fillModel, { type: "toggle" });
    realizeFill(fillModel);
    placePageTools(pageKind(location, document));
  });
  toolHolder().append(button);
  return button;
}

const WATCH_MEDIA_HEADER = "#content .erc-watch-episode .current-media-wrapper .current-media-header";

function watchMediaHeader() {
  return document.querySelector(WATCH_MEDIA_HEADER);
}

function toolHolder() {
  let holder = document.querySelector("[data-cr-tool-holder]");
  if (holder) return holder;
  holder = document.createElement("div");
  holder.dataset.crToolHolder = "1";
  holder.hidden = true;
  document.documentElement.append(holder);
  return holder;
}

function toolsRow(header) {
  const next = header.nextElementSibling;
  if (next?.dataset.crTools === "1") return next;
  const row = document.createElement("div");
  row.dataset.crTools = "1";
  row.style.display = "flex";
  row.style.gap = "8px";
  row.style.alignItems = "center";
  row.style.margin = "8px 0";
  header.insertAdjacentElement("afterend", row);
  return row;
}

function placePageTools(kind) {
  const header = kind === "watch" ? watchMediaHeader() : null;
  const row = header ? toolsRow(header) : null;
  const button = document.querySelector("button[data-cr-fill]");
  const link = document.querySelector("a[data-cr-mal]");
  if (!header) document.querySelector("[data-cr-tools]")?.remove();
  if (button) (row || toolHolder()).append(button);
  if (!link) return;
  if (row) {
    paintMal(link);
    row.append(link);
    return;
  }
  if (kind === "series") {
    paintMal(link);
    const ratings = document.querySelector("div.erc-ratings");
    if (ratings) {
      if (ratings.nextElementSibling !== link) ratings.insertAdjacentElement("afterend", link);
    } else {
      toolHolder().append(link);
    }
    return;
  }
  paintMal(link);
  toolHolder().append(link);
}

function paintMal(link) {
  link.style.background = "#2e51a2";
  link.style.color = "#fff";
  link.style.padding = "6px 10px";
  link.style.borderRadius = "4px";
  link.style.font = "700 14px/1.2 sans-serif";
  link.style.textDecoration = "none";
  link.style.display = "inline-block";
  link.style.position = "static";
  link.style.top = "";
  link.style.right = "";
  link.style.zIndex = "";
  link.style.width = "fit-content";
  link.style["justify-self"] = "center";
}

function clearMal() {
  document.querySelector("a[data-cr-mal]")?.remove();
}

function renderMal(record) {
  let link = document.querySelector("a[data-cr-mal]");
  if (!link) {
    link = document.createElement("a");
    link.dataset.crMal = "1";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    toolHolder().append(link);
  }
  link.href = `https://myanimelist.net/anime/${record.malId}`;
  link.textContent = malText(record.score);
  link.title = "Open in MAL.";
  link.setAttribute("aria-label", `${link.textContent}. Open in MAL.`);
  placePageTools(pageKind(location, document));
}

function malText(score) {
  return typeof score === "number" && Number.isFinite(score) ? `MAL ${score.toFixed(2)}` : "MAL";
}

function profileFromItem(item) {
  const img = item.querySelector("img");
  return {
    name: itemName(item) || null,
    avatarSrc: img?.currentSrc || img?.src || null,
  };
}

function itemName(item) {
  const alt = item.querySelector("img")?.alt?.trim();
  if (alt) return alt;
  const line = item.innerText.split("\n").map((part) => part.trim()).find(Boolean);
  return line || "";
}

function normalizeProfile(value) {
  if (!value || typeof value !== "object") return null;
  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : null;
  const avatarSrc = typeof value.avatarSrc === "string" && value.avatarSrc ? value.avatarSrc : null;
  if (!name && !avatarSrc) return null;
  return { name, avatarSrc };
}

function visible(el) {
  if (!el || !el.isConnected) return false;
  try {
    if (typeof el.checkVisibility === "function") {
      return el.checkVisibility({ opacityProperty: true });
    }
  } catch {
    return false;
  }
  const style = getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0;
}
