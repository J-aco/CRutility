const { FEATURES, settingsFromStored } = globalThis.crunchyrollTools;

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
