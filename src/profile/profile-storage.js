// profile-storage.js
// Thin wrapper around chrome.storage.local for the user's profile.
// Loaded by options.html and popup.html (NOT injected into web pages).

const PROFILE_KEY = "jobapply_profile_v1";

async function getProfile() {
  const result = await chrome.storage.local.get(PROFILE_KEY);
  if (result[PROFILE_KEY]) return result[PROFILE_KEY];
  const fresh = window.defaultProfile();
  await chrome.storage.local.set({ [PROFILE_KEY]: fresh });
  return fresh;
}

async function saveProfile(profile) {
  await chrome.storage.local.set({ [PROFILE_KEY]: profile });
}

function exportProfileToFile(profile) {
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "jobapply-autofill-profile.json";
  a.click();
  URL.revokeObjectURL(url);
}

async function importProfileFromFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  // Merge onto defaults so missing keys from an older export don't break the UI.
  const merged = Object.assign(window.defaultProfile(), parsed);
  await saveProfile(merged);
  return merged;
}

window.getProfile = getProfile;
window.saveProfile = saveProfile;
window.exportProfileToFile = exportProfileToFile;
window.importProfileFromFile = importProfileFromFile;
