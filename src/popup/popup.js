// popup.js
//
// Permission model (v0.4.0): the extension has no host permissions at
// install time. The first time the user tries to use it on a given site,
// we ask (via chrome.permissions.request, triggered by their own click on
// "Enable on this site") for host access to just that site's origin(s) —
// the top-level page plus any iframe origins it embeds (some ATS widgets
// live in a cross-origin iframe). Once granted, we inject the content
// script into the already-open tab immediately, and ask the background
// service worker to remember the origin so the content script keeps
// auto-injecting on future page loads there (needed for multi-page/
// multi-step application tracking to keep working without re-prompting on
// every step).

const CONTENT_SCRIPT_FILES = [
  "src/content/dom-utils.js",
  "src/content/field-detector.js",
  "src/content/field-classifier.js",
  "src/content/section-detector.js",
  "src/content/autofill-engine.js",
  "src/content/mutation-observer.js",
  "src/content/content.js"
];

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getAllFrames(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    return frames || [];
  } catch {
    return [];
  }
}

// A permission-request-shaped match pattern for a single frame's URL, or
// null for schemes that can't be requested this way (chrome://, about:, …).
// file:// pages (used by our own test-pages/) need "file:///*" — a plain
// hostname-based pattern doesn't apply since file URLs have no host. Note
// that file:// access ALSO requires the user to flip "Allow access to file
// URLs" for this extension in chrome://extensions — a manual toggle Chrome
// does not let an extension enable via any API — so requesting it will
// simply fail until that toggle is on. Real job-site usage is unaffected
// since actual ATS pages are always http(s).
function patternForUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol === "http:" || u.protocol === "https:") {
      return `${u.protocol}//${u.hostname}/*`;
    }
    if (u.protocol === "file:") {
      return "file:///*";
    }
  } catch {
    // unparsable URL (e.g. about:blank) — no pattern
  }
  return null;
}

// Returns permission-request-shaped origin patterns for every distinct
// requestable origin among the tab's frames.
function originPatternsFromFrames(frames) {
  const origins = new Set();
  for (const frame of frames) {
    const pattern = patternForUrl(frame.url);
    if (pattern) origins.add(pattern);
  }
  return Array.from(origins);
}

async function getFrameIdsForPatterns(frames, patterns) {
  // Used after granting permission, to inject into exactly the frames whose
  // origin we now have access to (skips about:blank, etc.).
  const patternSet = new Set(patterns);
  const ids = [];
  for (const frame of frames) {
    const pattern = patternForUrl(frame.url);
    if (pattern && patternSet.has(pattern)) ids.push(frame.frameId);
  }
  return ids.length ? ids : [0];
}

async function sendToFrames(tabId, frameIds, message) {
  const attempts = frameIds.map((frameId) =>
    chrome.tabs.sendMessage(tabId, message, { frameId }).catch(() => null)
  );
  const results = await Promise.all(attempts);
  return results.filter((r) => r !== null);
}

// Actively (re-)injects the content script into every frame we have
// permission for, every time the popup opens. This is deliberately NOT
// "inject once and trust it stays" — a single-page-app can swap huge parts
// of its DOM via client-side routing without a real navigation (so our
// declarative registerContentScripts registration never gets a fresh page
// load to fire on), and some Chrome "site access" settings (e.g. the
// extension's access mode set to "On click" in chrome://extensions) only
// make a granted host permission live for the tab at the moment the
// toolbar icon is actually clicked — which is exactly when the popup opens.
// content.js guards itself against double-injection, so calling this when
// the script is already present is a harmless no-op.
async function ensureContentScriptInjected(tabId, frameIds) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds },
      files: CONTENT_SCRIPT_FILES
    });
  } catch (err) {
    console.warn("[JobApplyAutofill] content script injection failed:", err);
  }
}

// --- Permission gating -----------------------------------------------------

function showPermissionPrompt(show) {
  document.getElementById("permissionPrompt").classList.toggle("hidden", !show);
  document.getElementById("counts").classList.toggle("hidden", show);
  document.getElementById("actions").classList.toggle("hidden", show);
}

let currentTabId = null;
let currentPatterns = [];
let currentFrames = [];

async function checkPermissionForActiveTab() {
  const tab = await getActiveTab();
  if (!tab?.id) return { granted: false, patterns: [] };
  currentTabId = tab.id;
  currentFrames = await getAllFrames(tab.id);
  currentPatterns = originPatternsFromFrames(currentFrames);

  if (!currentPatterns.length) {
    // e.g. a chrome:// page, or a page whose frames haven't finished loading yet.
    return { granted: false, patterns: [], noPatterns: true };
  }

  try {
    const granted = await chrome.permissions.contains({ origins: currentPatterns });
    return { granted, patterns: currentPatterns };
  } catch {
    return { granted: false, patterns: currentPatterns };
  }
}

async function enableOnThisSite() {
  const btn = document.getElementById("enableSiteBtn");
  btn.disabled = true;
  btn.textContent = "Requesting…";
  try {
    const granted = await chrome.permissions.request({ origins: currentPatterns });
    if (!granted) {
      btn.disabled = false;
      btn.textContent = "Enable on this site";
      return;
    }

    // Inject into the already-open tab right away (dynamic registration only
    // affects future navigations, not the page that's already loaded).
    const frameIds = await getFrameIdsForPatterns(currentFrames, currentPatterns);
    await ensureContentScriptInjected(currentTabId, frameIds);

    // Remember this origin so future page loads here (multi-page/multi-step
    // applications) auto-inject without asking again.
    await chrome.runtime.sendMessage({ type: "REGISTER_GRANTED_ORIGINS", patterns: currentPatterns });

    showPermissionPrompt(false);
    await refreshPopup();
  } catch (err) {
    alert("Could not enable the extension on this site. Try again.");
    btn.disabled = false;
    btn.textContent = "Enable on this site";
  }
}

// --- Normal popup behavior (once permission is granted) --------------------

async function loadProfileSummary() {
  const PROFILE_KEY = "jobapply_profile_v1";
  const result = await chrome.storage.local.get(PROFILE_KEY);
  const profile = result[PROFILE_KEY];
  const line = document.getElementById("profileLine");
  if (!profile || !profile.firstName) {
    line.textContent = "No profile saved yet — click 'Review Profile / Settings' below.";
    return;
  }
  line.textContent = `${profile.firstName} ${profile.lastName || ""} · ${profile.email || ""}`.trim();
}

async function loadSessionLine(tab) {
  const el = document.getElementById("sessionLine");
  try {
    const session = await chrome.runtime.sendMessage({ type: "GET_SESSION", url: tab.url });
    if (session && session.pagesVisited && session.pagesVisited.length > 1) {
      el.textContent = `In progress on this site — step ${session.pagesVisited.length} (page${session.pagesVisited.length > 1 ? "s" : ""} visited so far).`;
    } else {
      el.textContent = "";
    }
  } catch {
    el.textContent = "";
  }
}

function renderScan(totalFields, fillable) {
  document.getElementById("fillableCount").textContent = fillable;
  const remaining = Math.max(totalFields - fillable, 0);
  document.getElementById("reviewCount").textContent = 0;
  document.getElementById("unknownCount").textContent = remaining;
}

async function scanActiveTab() {
  if (!currentTabId) return;
  try {
    const frameIds = currentFrames.length ? currentFrames.map((f) => f.frameId) : [0];
    const scans = await sendToFrames(currentTabId, frameIds, { type: "SCAN" });
    if (!scans.length) {
      document.getElementById("profileLine").textContent =
        "Can't scan yet — try 'Rescan Page' (the content script may still be loading).";
      return;
    }
    const totalFields = scans.reduce((sum, s) => sum + (s.totalFields || 0), 0);
    const fillable = scans.reduce((sum, s) => sum + (s.fillable || 0), 0);
    renderScan(totalFields, fillable);
  } catch (e) {
    document.getElementById("profileLine").textContent = "Could not scan this page.";
  }
}

async function fillActiveTab() {
  if (!currentTabId) return;
  const btn = document.getElementById("fillBtn");
  btn.disabled = true;
  btn.textContent = "Filling…";
  try {
    const frameIds = currentFrames.length ? currentFrames.map((f) => f.frameId) : [0];
    const results = await sendToFrames(currentTabId, frameIds, { type: "FILL" });
    const merged = results.reduce(
      (acc, r) => ({
        filled: acc.filled.concat(r.filled || []),
        skipped: acc.skipped.concat(r.skipped || []),
        unknown: acc.unknown.concat(r.unknown || []),
        fileFields: acc.fileFields.concat(r.fileFields || []),
        sectionNotices: acc.sectionNotices.concat(r.sectionNotices || [])
      }),
      { filled: [], skipped: [], unknown: [], fileFields: [], sectionNotices: [] }
    );

    document.getElementById("resultBox").classList.remove("hidden");
    document.getElementById("resultSummary").innerHTML = `
      <div>✓ ${merged.filled.length} filled</div>
      <div>⚠ ${merged.skipped.length} skipped</div>
      <div>? ${merged.unknown.length} unknown</div>
      ${merged.fileFields.length ? `<div>📎 ${merged.fileFields.length} file upload field(s) — pick the file manually</div>` : ""}
      ${merged.sectionNotices.map((n) => `<div class="notice">ℹ️ ${n}</div>`).join("")}
      ${results.length > 1 ? `<div class="muted">(combined across ${results.length} frame${results.length > 1 ? "s" : ""} on this page)</div>` : ""}
    `;
    document.getElementById("fillableCount").textContent = merged.filled.length;
    document.getElementById("reviewCount").textContent = merged.skipped.length;
    document.getElementById("unknownCount").textContent = merged.unknown.length;
  } catch (e) {
    alert("Could not fill this page. Try reloading the tab and reopening the popup.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Fill Application";
  }
}

// Extension popups have flaky, inconsistent support for window.confirm()/
// alert() across Chrome versions (a modal dialog from a small transient
// popup window can fail to show, or the popup can lose focus and close
// before the person responds) -- unacceptable for something that gates a
// destructive action. So this asks inline, inside the popup's own markup,
// instead of relying on a native dialog.
function showCleanupConfirm(show) {
  document.getElementById("cleanupConfirm").classList.toggle("hidden", !show);
  document.getElementById("actions").classList.toggle("hidden", show);
}

async function runCleanupExtraEntries() {
  if (!currentTabId) return;
  showCleanupConfirm(false);

  const btn = document.getElementById("cleanupBtn");
  btn.disabled = true;
  btn.textContent = "Removing…";
  try {
    const frameIds = currentFrames.length ? currentFrames.map((f) => f.frameId) : [0];
    const results = await sendToFrames(currentTabId, frameIds, { type: "CLEANUP_EXTRA" });
    const removed = results.reduce((sum, r) => sum + (r.removed || []).length, 0);
    const notRemovable = results.reduce((sum, r) => sum + (r.notRemovable || []).length, 0);

    document.getElementById("resultBox").classList.remove("hidden");
    const lines = [];
    if (removed) lines.push(`<div>✓ Removed ${removed} extra entr${removed === 1 ? "y" : "ies"}.</div>`);
    if (notRemovable) {
      lines.push(
        `<div class="notice">ℹ️ Couldn't find a Delete control for ${notRemovable} extra entr${notRemovable === 1 ? "y" : "ies"} — ${notRemovable === 1 ? "it's" : "they're"} highlighted for you to remove manually.</div>`
      );
    }
    if (!removed && !notRemovable) lines.push(`<div>No extra entries found beyond your saved profile.</div>`);
    document.getElementById("resultSummary").innerHTML = lines.join("");

    await scanActiveTab();
  } catch (e) {
    document.getElementById("resultBox").classList.remove("hidden");
    document.getElementById("resultSummary").innerHTML =
      `<div class="notice">⚠ Could not clean up extra entries. Try reloading the tab and reopening the popup.</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Remove Extra Entries";
  }
}

async function undoActiveTab() {
  if (!currentTabId) return;
  const frameIds = currentFrames.length ? currentFrames.map((f) => f.frameId) : [0];
  await sendToFrames(currentTabId, frameIds, { type: "UNDO" });
  document.getElementById("resultBox").classList.add("hidden");
}

document.getElementById("fillBtn").addEventListener("click", fillActiveTab);
document.getElementById("scanBtn").addEventListener("click", scanActiveTab);
document.getElementById("undoBtn").addEventListener("click", undoActiveTab);
document.getElementById("cleanupBtn").addEventListener("click", () => showCleanupConfirm(true));
document.getElementById("cleanupConfirmYes").addEventListener("click", runCleanupExtraEntries);
document.getElementById("cleanupConfirmNo").addEventListener("click", () => showCleanupConfirm(false));
document.getElementById("optionsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.getElementById("enableSiteBtn").addEventListener("click", enableOnThisSite);

async function refreshPopup() {
  await loadProfileSummary();
  const tab = await getActiveTab();
  if (tab) await loadSessionLine(tab);
  await scanActiveTab();
}

(async function init() {
  await loadProfileSummary();
  const { granted, patterns, noPatterns } = await checkPermissionForActiveTab();

  if (noPatterns) {
    showPermissionPrompt(false);
    document.getElementById("profileLine").textContent =
      "This isn't a regular web page (or it hasn't finished loading) — nothing to fill here.";
    return;
  }

  if (!granted) {
    showPermissionPrompt(true);
    return;
  }

  showPermissionPrompt(false);

  // Permission exists, but don't assume a content script is actually present
  // in this tab right now (SPA navigation, a restrictive "site access" mode,
  // or a service worker restart can all leave it missing) — re-inject every
  // time, since content.js's own guard makes this a no-op if it's already there.
  const frameIds = await getFrameIdsForPatterns(currentFrames, currentPatterns);
  await ensureContentScriptInjected(currentTabId, frameIds);

  const tab = await getActiveTab();
  if (tab) await loadSessionLine(tab);
  await scanActiveTab();
})();
