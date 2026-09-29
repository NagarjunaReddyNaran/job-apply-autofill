// content.js
// Entry point injected into every frame of every page (all_frames: true in
// manifest.json), since some ATS platforms embed the actual application
// form inside an iframe rather than the top-level document. Talks to
// popup.js (on-demand actions, addressed per-frame) and to the background
// service worker (passive session/progress tracking).

(function () {
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
          // One malformed field shouldn't stop the whole scan.
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
      // sender.frameId is attached automatically by Chrome on the receiving end;
      // we don't need to (and can't reliably) compute our own frame id here.
      chrome.runtime.sendMessage({
        type: "PAGE_SCANNED",
        url: location.href,
        title: document.title,
        totalFields: scan.totalFields,
        fillable: scan.fillable,
        isTopFrame
      }).catch(() => {
        // Extension may have been reloaded/updated mid-session ("context invalidated").
        // Safe to ignore — the next scan or a page reload will recover.
      });
    } catch (err) {
      // chrome.runtime may be unavailable entirely in rare edge cases (e.g. the
      // extension was just disabled). Fail silently rather than throwing on the host page.
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (message.type === "SCAN") {
        sendResponse(safeScanSummary());
        return true;
      }
      if (message.type === "FILL") {
        window.getProfileForContentScript()
          .then((profile) => {
            try {
              const result = window.JobApplyAutofill.runAutofill(profile);
              notifyBackground();
              sendResponse(result);
            } catch (fillErr) {
              console.warn("[JobApplyAutofill] fill failed:", fillErr);
              sendResponse({ filled: [], skipped: [], unknown: [], fileFields: [], error: String(fillErr) });
            }
          })
          .catch((err) => {
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

  // Initial scan + notify on load, then watch for dynamically added fields.
  // Wrapped so a failure here never breaks the host page itself.
  try {
    notifyBackground();
    window.JobApplyObserver.observeDynamicFields(notifyBackground, 600);
  } catch (err) {
    console.warn("[JobApplyAutofill] failed to initialize on this page/frame:", err);
  }
})();
