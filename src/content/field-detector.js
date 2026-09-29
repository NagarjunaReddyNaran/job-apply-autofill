// field-detector.js
// Scans a document (or subtree) for form controls and returns structured
// field descriptors, without yet deciding what they mean semantically.

(function () {
  function isVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function detectFields(root = document) {
    const fields = [];
    const radioGroups = new Map(); // name -> [elements]

    const controls = root.querySelectorAll("input, textarea, select, [role='combobox'], [role='radio'], [role='checkbox']");

    controls.forEach((el) => {
      try {
        if (!isVisible(el)) return;
        const type = (el.getAttribute("type") || "").toLowerCase();

        if (el.tagName === "INPUT" && type === "radio" && el.name) {
          if (!radioGroups.has(el.name)) radioGroups.set(el.name, []);
          radioGroups.get(el.name).push(el);
          return; // handled as a group below
        }

        if (el.tagName === "INPUT" && type === "file") {
          fields.push({ kind: "file", element: el, signals: window.JobApplyDom.collectSignals(el) });
          return;
        }

        if (el.tagName === "INPUT" && type === "checkbox") {
          fields.push({ kind: "checkbox", element: el, signals: window.JobApplyDom.collectSignals(el) });
          return;
        }

        if (el.tagName === "SELECT") {
          fields.push({
            kind: "select",
            element: el,
            signals: window.JobApplyDom.collectSignals(el),
            options: Array.from(el.options).map((o) => ({ value: o.value, text: o.textContent.trim() }))
          });
          return;
        }

        if (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["radio", "checkbox", "file", "submit", "button", "hidden"].includes(type))) {
          fields.push({ kind: "text", element: el, signals: window.JobApplyDom.collectSignals(el) });
          return;
        }
      } catch (err) {
        console.warn("[JobApplyAutofill] skipped an element during detection:", err);
      }
    });

    radioGroups.forEach((elements, name) => {
      try {
        const first = elements[0];
        fields.push({
          kind: "radio-group",
          elements,
          name,
          signals: window.JobApplyDom.collectSignals(first),
          options: elements.map((el) => ({
            value: el.value,
            text: window.JobApplyDom.getLabelText(el) || el.value
          }))
        });
      } catch (err) {
        console.warn("[JobApplyAutofill] skipped a radio group during detection:", err);
      }
    });

    return fields;
  }

  window.JobApplyDetector = { detectFields };
})();
