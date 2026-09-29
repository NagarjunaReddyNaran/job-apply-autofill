// service-worker.js
// Passive multi-page session tracking (Feature 12, simplified for the MVP):
// - Remembers which top-level pages of the same domain have been visited,
//   so the popup can show "Step N" style progress.
// - Aggregates the fillable-field count across ALL frames of a tab (the top
//   page plus any iframes, since some ATS platforms embed the actual
//   application form in an iframe) for the toolbar badge.
//
// This does NOT click Next/Continue and does NOT auto-fill — it only tracks
// and displays progress so the user can see continuity across pages/frames.

const SESSION_KEY_PREFIX = "jobapply_session_"; // + domain

// In-memory per-tab, per-frame fillable counts. Cleared naturally when the
// service worker is evicted/restarted (Chrome will re-populate on next scan).
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
    // Tab may have closed between the scan and this update — safe to ignore.
  }
}

async function handlePageScanned(message, tabId, frameId) {
  // Track this frame's fillable count for badge aggregation regardless of
  // whether it's the top frame or an embedded ATS iframe.
  if (!frameCounts.has(tabId)) frameCounts.set(tabId, new Map());
  frameCounts.get(tabId).set(frameId, message.fillable || 0);
  updateBadge(tabId);

  // Only the top frame's URL represents a "page" for step/progress tracking —
  // an iframe's own src would otherwise pollute the same-domain page list
  // (and is often on an entirely different domain, e.g. an embedded ATS widget).
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
  } catch (err) {
    console.warn("[JobApplyAutofill] background message handling failed:", err);
  }
});

// Reset per-tab frame counts and badge when a tab starts navigating to a new
// top-level page — the new page's frames will re-report shortly after load.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    frameCounts.delete(tabId);
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  frameCounts.delete(tabId);
});
