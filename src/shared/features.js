/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (C) 2026 Fred and contributors. Upstream portions retain their owners' rights.
 * Modified work; compliance changes dated 2026-11-14. See ../../docs/THIRD_PARTY_NOTICES.md.
 * Distributed without warranty; see ../../LICENSE for the full terms.
 */
const FEATURES = [
  { id: "profile", label: "Remember the last profile" },
  { id: "promos", label: "Skip promos" },
  { id: "intros", label: "Skip intros" },
  { id: "outros", label: "Skip outros" },
  { id: "recaps", label: "Skip recaps" },
  { id: "mal", label: "Show the MyAnimeList score" },
  { id: "fill", label: "Fill the watch page player" },
];

const SKIP_RULES = [
  {
    kind: "recap",
    featureId: "recaps",
    match(label) {
      return includesWord(label, "recap");
    },
  },
  {
    kind: "outro",
    featureId: "outros",
    match(label) {
      return includesWord(label, "credits") || includesWord(label, "outro") || includesWord(label, "ending");
    },
  },
  {
    kind: "intro",
    featureId: "intros",
    match(label, playbackFraction) {
      return includesWord(label, "intro") && playbackFraction < 0.5;
    },
  },
  {
    kind: "outro",
    featureId: "outros",
    match(label, playbackFraction) {
      return includesWord(label, "intro") && playbackFraction >= 0.5;
    },
  },
  {
    kind: "promo",
    featureId: "promos",
    match(label, playbackFraction, hasSkipIcon) {
      if (hasSkipIcon === true && isExactSkip(label)) return true;
      return includesWord(label, "promo") && playbackFraction < 0.5;
    },
  },
];

function settingsFromStored(stored) {
  const settings = {};
  for (const feature of FEATURES) {
    settings[feature.id] = stored?.[feature.id] !== false;
  }
  return settings;
}

function skipControlOffered(state, kind) {
  if (kind === "promo") {
    const ariaHidden = state && typeof state === "object" ? state.ariaHidden : null;
    const currentTime = state && typeof state === "object" ? state.currentTime : null;
    if (ariaHidden !== "false") return false;
    return typeof currentTime === "number" && Number.isFinite(currentTime) && currentTime <= 5;
  }
  const className = typeof state === "string" ? state : state?.className;
  return !String(className || "").split(/\s+/).includes("kat:opacity-0");
}

function classifySkip(label, playbackFraction, hasSkipIcon = false) {
  if (typeof label !== "string") return null;
  if (typeof playbackFraction !== "number" || !Number.isFinite(playbackFraction)) return null;
  for (const rule of SKIP_RULES) {
    if (rule.match(label, playbackFraction, hasSkipIcon)) return rule.kind;
  }
  return null;
}

function featureIdForKind(kind) {
  const rule = SKIP_RULES.find((item) => item.kind === kind);
  return rule ? rule.featureId : null;
}

function pickMalHit(query, hits) {
  if (typeof query !== "string" || !Array.isArray(hits) || hits.length === 0) return null;
  const wanted = normalizeTitle(query);
  if (!wanted) return null;
  let best = null;
  let bestRank = Infinity;
  for (const hit of hits) {
    const rank = rankHit(wanted, hit);
    if (rank == null || rank >= bestRank) continue;
    bestRank = rank;
    best = hit;
  }
  return best;
}

function includesWord(label, word) {
  return new RegExp(`\\b${word}\\b`, "i").test(label);
}

function isExactSkip(label) {
  return label.trim().replace(/\s+/g, " ").toLowerCase() === "skip";
}

function rankHit(wanted, hit) {
  if (!hit || typeof hit !== "object") return null;
  const names = [hit.title, hit.titleEnglish, hit.title_english];
  let best = null;
  for (const name of names) {
    if (typeof name !== "string") continue;
    const rank = rankName(wanted, normalizeTitle(name));
    if (rank == null) continue;
    if (best == null || rank < best) best = rank;
  }
  return best;
}

function rankName(wanted, name) {
  if (!name) return null;
  if (name === wanted) return 0;
  if (name.startsWith(wanted) || wanted.startsWith(name)) {
    return 1 + Math.abs(name.length - wanted.length) / 1000;
  }
  if (name.includes(wanted) || wanted.includes(name)) {
    return 2 + Math.abs(name.length - wanted.length) / 1000;
  }
  const overlap = tokenRank(wanted, name);
  if (overlap != null) return overlap;
  const distance = levenshtein(wanted, name);
  const limit = Math.floor(Math.max(wanted.length, name.length) * 0.34);
  if (distance > Math.max(2, limit)) return null;
  return 3 + distance;
}

function tokenRank(wanted, name) {
  const stop = new Set(["the", "a", "an", "of", "and", "no", "wa", "movie", "season", "part", "cour", "ova", "tv", "hen"]);
  const tokens = (value) => value.split(" ").filter((token) => token.length > 2 && !stop.has(token));
  const wantedTokens = tokens(wanted);
  const nameTokens = new Set(tokens(name));
  if (wantedTokens.length < 2 || nameTokens.size === 0) return null;
  const shared = wantedTokens.filter((token) => nameTokens.has(token));
  const last = [...wantedTokens].reverse().find((token) => token.length >= 5) || wantedTokens[wantedTokens.length - 1];
  if (!nameTokens.has(last)) return null;
  if (shared.length < 2 || shared.length / wantedTokens.length < 0.6) return null;
  return 2.5 + (1 - shared.length / wantedTokens.length);
}

function normalizeTitle(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function levenshtein(left, right) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_unused, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[right.length];
}

function reduceFill(model, event) {
  const current = model && typeof model === "object"
    ? model
    : { href: "", expanded: false, showButton: false };
  if (!event || event.type === "disable") {
    return { href: "", expanded: false, showButton: false };
  }
  if (event.type === "toggle") {
    if (!current.showButton) return { ...current };
    return { ...current, expanded: !current.expanded };
  }
  const showButton = event.pageKind === "watch" && event.enabled === true;
  if (!showButton) return { href: event.href || "", expanded: false, showButton: false };
  const sameVisit = current.href === event.href && current.showButton === true;
  return {
    href: event.href,
    expanded: sameVisit ? current.expanded === true : true,
    showButton: true,
  };
}

globalThis.crUtility = {
  FEATURES,
  settingsFromStored,
  skipControlOffered,
  classifySkip,
  featureIdForKind,
  pickMalHit,
  reduceFill,
};
