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
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = settings[feature.id];
  input.addEventListener("change", () => {
    chrome.storage.local.set({ [feature.id]: input.checked });
  });
  label.append(input, document.createTextNode(feature.label));
  form.append(label);
}
