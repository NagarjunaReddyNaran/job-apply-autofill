// service-worker.js
// Passive multi-page session tracking (simplified MVP):
// - Remembers which top-level pages of the same domain have been visited,
//   so the popup can show "Step N" style progress.
// - Aggregates the fillable-field count across ALL frames of a tab (the top
//   page plus any iframes, since some ATS platforms embed the actual
//   application form in an iframe) for the toolbar badge.
//
// This does NOT click Next/Continue and does NOT auto-fill — it only tracks
// and displays progress so the user can see continuity across pages/frames.
//
// Permission model (v0.4.0): the extension no longer requests <all_urls> at
// install time. Instead, popup.js asks the user to grant host permission for
// a specific site's origin(s) the first time they click Fill there. Once
// granted, we register the content script dynamically for that origin so it
// keeps auto-running on later page loads within the same site — this is
// what keeps multi-page session tracking working without re-prompting on
// every step of a multi-page application.

const SESSION_KEY_PREFIX = "jobapply_session_"; // + domain
const GRANTED_ORIGINS_KEY = "jobapply_granted_origins_v1";
const CONTENT_SCRIPT_ID = "jobapply-main";
const CONTENT_SCRIPT_FILES = [
  "src/content/dom-utils.js",
  "src/content/field-detector.js",
  "src/content/field-classifier.js",
  "src/content/section-detector.js",
  "src/content/autofill-engine.js",
  "src/content/mutation-observer.js",
  "src/content/content.js"
];

const frameCounts = new Map(); // tabId -> Map<frameId, fillable>

function domainOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

async function getSession(domain) {
  try {
    const key = SESSION_KEY_PREFIX + domain;
    const result = await chrome.storage.session.get(key);
    return result[key] || null;
  } catch {
    return null;
  }
}

async function saveSession(domain, session) {
  try {
    const key = SESSION_KEY_PREFIX + domain;
    await chrome.storage.session.set({ [key]: session });
  } catch (err) {
    console.warn("[JobApplyAutofill] failed to save session:", err);
  }
}

async function updateBadge(tabId) {
  try {
    const perFrame = frameCounts.get(tabId);
    const total = perFrame ? Array.from(perFrame.values()).reduce((sum, n) => sum + n, 0) : 0;
    await chrome.action.setBadgeText({ tabId, text: total > 0 ? String(total) : "" });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#22c55e" });
  } catch {
    // Tab may have closed between the scan and this update.
  }
}

async function handlePageScanned(message, tabId, frameId) {
  if (!frameCounts.has(tabId)) frameCounts.set(tabId, new Map());
  frameCounts.get(tabId).set(frameId, message.fillable || 0);
  updateBadge(tabId);

  if (!message.isTopFrame) return;

  const domain = domainOf(message.url);
  let session = await getSession(domain);

  if (!session) {
    session = { domain, startedAt: Date.now(), pagesVisited: [], status: "in_progress" };
  }

  if (!session.pagesVisited.some((p) => p.url === message.url)) {
    session.pagesVisited.push({ url: message.url, title: message.title, visitedAt: Date.now() });
  }
  session.lastActivityAt = Date.now();
  session.lastFillable = message.fillable;
  session.lastTotalFields = message.totalFields;

  await saveSession(domain, session);
}

// --- Dynamic content-script registration, driven by granted permissions ---
// We keep ONE registered content script whose `matches` list is the full set
// of origins the user has granted so far, rather than one registration per
// origin. This keeps things simple and avoids hitting any per-script limits.

async function getGrantedOriginPatterns() {
  try {
    const result = await chrome.storage.local.get(GRANTED_ORIGINS_KEY);
    return result[GRANTED_ORIGINS_KEY] || [];
  } catch {
    return [];
  }
}

async function saveGrantedOriginPatterns(patterns) {
  try {
    await chrome.storage.local.set({ [GRANTED_ORIGINS_KEY]: patterns });
  } catch (err) {
    console.warn("[JobApplyAutofill] failed to save granted origins:", err);
  }
}

async function syncContentScriptRegistration() {
  try {
    const patterns = await getGrantedOriginPatterns();
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] });

    if (patterns.length === 0) {
      if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
      return;
    }

    const definition = {
      id: CONTENT_SCRIPT_ID,
      matches: patterns,
      js: CONTENT_SCRIPT_FILES,
      allFrames: true,
      runAt: "document_idle"
    };

    if (existing.length) {
      await chrome.scripting.updateContentScripts([definition]);
    } else {
      await chrome.scripting.registerContentScripts([definition]);
    }
  } catch (err) {
    console.warn("[JobApplyAutofill] failed to sync content script registration:", err);
  }
}

// Adds newly-granted origin patterns (e.g. "https://example.com/*") to the
// persisted list and re-syncs the dynamic content script's match list so
// future page loads on that origin auto-inject without re-prompting.
async function addGrantedOrigins(newPatterns) {
  const current = await getGrantedOriginPatterns();
  const merged = Array.from(new Set([...current, ...newPatterns]));
  await saveGrantedOriginPatterns(merged);
  await syncContentScriptRegistration();
  return merged;
}

// Re-sync on startup/install in case the browser cleared dynamic
// registrations (e.g. after an extension update) while permissions were
// still granted — otherwise sites the user already approved would silently
// stop auto-injecting until they revisit and the popup notices and re-injects.
chrome.runtime.onInstalled.addListener(() => { syncContentScriptRegistration(); });
chrome.runtime.onStartup.addListener(() => { syncContentScriptRegistration(); });

// If the user revokes a host permission from chrome://extensions directly,
// keep our own bookkeeping and registration in sync with that.
chrome.permissions.onRemoved.addListener(async (removed) => {
  if (!removed.origins || !removed.origins.length) return;
  const current = await getGrantedOriginPatterns();
  const remaining = current.filter((p) => !removed.origins.includes(p));
  await saveGrantedOriginPatterns(remaining);
  await syncContentScriptRegistration();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message.type === "PAGE_SCANNED" && sender.tab) {
      handlePageScanned(message, sender.tab.id, sender.frameId ?? 0);
    }
    if (message.type === "GET_SESSION") {
      getSession(domainOf(message.url))
        .then((session) => sendResponse(session))
        .catch(() => sendResponse(null));
      return true; // async
    }
    if (message.type === "REGISTER_GRANTED_ORIGINS") {
      addGrantedOrigins(message.patterns || [])
        .then((merged) => sendResponse({ ok: true, patterns: merged }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true; // async
    }
  } catch (err) {
    console.warn("[JobApplyAutofill] background message handling failed:", err);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    frameCounts.delete(tabId);
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  frameCounts.delete(tabId);
});
