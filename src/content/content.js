// content.js
// Entry point injected into every frame of every page (all_frames: true in
// manifest.json), since some ATS platforms embed the actual application
// form inside an iframe rather than the top-level document. Talks to
// popup.js (on-demand actions, addressed per-frame) and to the background
// service worker (passive session/progress tracking).

(function () {
  // Guard against double-injection: the popup re-injects this script on
  // every open (see popup.js ensureContentScriptInjected) to recover from
  // cases where an earlier injection didn't take (or an SPA navigation
  // swapped out the DOM without a real page load re-triggering our
  // declarative registration). Running the whole file twice in the same
  // frame would double up message listeners and mutation observers, so we
  // bail out early on a repeat injection.
  if (window.__jobApplyAutofillLoaded) return;
  window.__jobApplyAutofillLoaded = true;

  const isTopFrame = window.self === window.top;

  function safeScanSummary() {
    try {
      const fields = window.JobApplyDetector.detectFields(document);
      let fillable = 0;
      for (const field of fields) {
        try {
          if (field.kind === "file") continue;
          const { semanticField, confidence } = window.JobApplyClassifier.classifyField(field.signals);
          if (semanticField && confidence >= window.JobApplyAutofill.CONFIDENCE_THRESHOLD) fillable++;
        } catch (fieldErr) {
          console.warn("[JobApplyAutofill] skipped a field during scan:", fieldErr);
        }
      }
      return { totalFields: fields.length, fillable, isTopFrame, url: location.href };
    } catch (err) {
      console.warn("[JobApplyAutofill] scan failed on this page/frame:", err);
      return { totalFields: 0, fillable: 0, isTopFrame, url: location.href, error: String(err) };
    }
  }

  function notifyBackground() {
    try {
      const scan = safeScanSummary();
      chrome.runtime.sendMessage({
        type: "PAGE_SCANNED",
        url: location.href,
        title: document.title,
        totalFields: scan.totalFields,
        fillable: scan.fillable,
        isTopFrame
      }).catch(() => {
        // Extension may have been reloaded/updated mid-session ("context invalidated").
      });
    } catch (err) {
      // chrome.runtime may be unavailable entirely in rare edge cases.
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (message.type === "SCAN") {
        sendResponse(safeScanSummary());
        return true;
      }
      if (message.type === "FILL") {
        // runAutofill is async (custom-combobox widgets need to click to
        // open, wait for the rendered options, then click the right one —
        // each of those is a real DOM round-trip, not instantaneous).
        window.getProfileForContentScript()
          .then((profile) => window.JobApplyAutofill.runAutofill(profile))
          .then((result) => {
            notifyBackground();
            sendResponse(result);
          })
          .catch((err) => {
            console.warn("[JobApplyAutofill] fill failed:", err);
            sendResponse({ filled: [], skipped: [], unknown: [], fileFields: [], error: String(err) });
          });
        return true; // async response
      }
      if (message.type === "UNDO") {
        try {
          window.JobApplyAutofill.undoAutofill();
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: String(err) });
        }
        return true;
      }
    } catch (err) {
      console.warn("[JobApplyAutofill] message handling failed:", err);
      try { sendResponse({ error: String(err) }); } catch {}
      return true;
    }
  });

  window.getProfileForContentScript = async function () {
    const PROFILE_KEY = "jobapply_profile_v1";
    try {
      const result = await chrome.storage.local.get(PROFILE_KEY);
      return result[PROFILE_KEY] || { enableEeoAutofill: false, highlightFields: true };
    } catch {
      return { enableEeoAutofill: false, highlightFields: true };
    }
  };

  try {
    notifyBackground();
    window.JobApplyObserver.observeDynamicFields(notifyBackground, 600);
  } catch (err) {
    console.warn("[JobApplyAutofill] failed to initialize on this page/frame:", err);
  }
})();
