// mutation-observer.js
// Watches for DOM changes (dynamically loaded fields) and notifies content.js
// via a debounced callback, rather than rescanning on every mutation.

(function () {
  function observeDynamicFields(onChange, debounceMs = 500) {
    let timer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(onChange, debounceMs);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
  }

  window.JobApplyObserver = { observeDynamicFields };
})();
