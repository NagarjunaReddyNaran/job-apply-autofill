// popup.js

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getFrameIds(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    // Only frames Chrome could actually identify; getAllFrames can return
    // null on some pages (e.g. chrome:// pages), so guard against that.
    return (frames || []).map((f) => f.frameId);
  } catch {
    return [0]; // fall back to just the top frame
  }
}

async function sendToAllFrames(tabId, message) {
  const frameIds = await getFrameIds(tabId);
  const attempts = frameIds.map((frameId) =>
    chrome.tabs.sendMessage(tabId, message, { frameId }).catch(() => null)
  );
  const results = await Promise.all(attempts);
  // Drop frames that didn't respond (sandboxed iframes, about:blank, pages
  // where the content script couldn't run, etc.) rather than failing outright.
  return results.filter((r) => r !== null);
}

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
  const tab = await getActiveTab();
  if (!tab?.id) return;
  try {
    const scans = await sendToAllFrames(tab.id, { type: "SCAN" });
    if (!scans.length) {
      document.getElementById("profileLine").textContent =
        "Can't access this page (try a normal http/https job application page).";
      return;
    }
    const totalFields = scans.reduce((sum, s) => sum + (s.totalFields || 0), 0);
    const fillable = scans.reduce((sum, s) => sum + (s.fillable || 0), 0);
    renderScan(totalFields, fillable);
  } catch (e) {
    document.getElementById("profileLine").textContent =
      "Can't access this page (try a normal http/https job application page).";
  }
}

async function fillActiveTab() {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  const btn = document.getElementById("fillBtn");
  btn.disabled = true;
  btn.textContent = "Filling…";
  try {
    const results = await sendToAllFrames(tab.id, { type: "FILL" });
    const merged = results.reduce(
      (acc, r) => ({
        filled: acc.filled.concat(r.filled || []),
        skipped: acc.skipped.concat(r.skipped || []),
        unknown: acc.unknown.concat(r.unknown || []),
        fileFields: acc.fileFields.concat(r.fileFields || [])
      }),
      { filled: [], skipped: [], unknown: [], fileFields: [] }
    );

    document.getElementById("resultBox").classList.remove("hidden");
    document.getElementById("resultSummary").innerHTML = `
      <div>✓ ${merged.filled.length} filled</div>
      <div>⚠ ${merged.skipped.length} skipped</div>
      <div>? ${merged.unknown.length} unknown</div>
      ${merged.fileFields.length ? `<div>📎 ${merged.fileFields.length} file upload field(s) — pick the file manually</div>` : ""}
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

async function undoActiveTab() {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  await sendToAllFrames(tab.id, { type: "UNDO" });
  document.getElementById("resultBox").classList.add("hidden");
}

document.getElementById("fillBtn").addEventListener("click", fillActiveTab);
document.getElementById("scanBtn").addEventListener("click", scanActiveTab);
document.getElementById("undoBtn").addEventListener("click", undoActiveTab);
document.getElementById("optionsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());

(async function init() {
  await loadProfileSummary();
  const tab = await getActiveTab();
  if (tab) {
    await loadSessionLine(tab);
    await scanActiveTab();
  }
})();
