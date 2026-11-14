/*
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (C) 2026 Fred and contributors. Upstream portions retain their owners' rights.
 * Modified work; compliance changes dated 2026-11-14. See ../../docs/THIRD_PARTY_NOTICES.md.
 * Distributed without warranty; see ../../LICENSE for the full terms.
 */
const { FEATURES, settingsFromStored } = globalThis.crUtility;

const form = document.querySelector("#features");
const stored = await chrome.storage.local.get(FEATURES.map((feature) => feature.id));
const settings = settingsFromStored(stored);

for (const feature of FEATURES) {
  const label = document.createElement("label");
  label.className = "feature";
  const text = document.createElement("span");
  text.textContent = feature.label;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "feature-toggle";
  input.setAttribute("role", "switch");
  input.id = feature.id;
  input.name = feature.id;
  input.checked = settings[feature.id];
  input.addEventListener("change", () => {
    chrome.storage.local.set({ [feature.id]: input.checked });
  });
  label.append(text, input);
  form.append(label);
}
