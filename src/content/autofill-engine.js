// autofill-engine.js
// Orchestrates: detect fields -> classify -> resolve value from profile ->
// write value (with framework-safe events) -> highlight -> summarize.

(function () {
  const CONFIDENCE_THRESHOLD = 0.55;

  function boolToYesNo(value) {
    if (value === true) return ["yes", "true", "y"];
    if (value === false) return ["no", "false", "n"];
    return [];
  }

  function pickSelectOption(options, profileValue) {
    if (profileValue === "" || profileValue === null || profileValue === undefined) return null;
    const target = String(profileValue).toLowerCase();
    let match = options.find((o) => o.text.toLowerCase() === target || o.value.toLowerCase() === target);
    if (match) return match;
    match = options.find((o) => o.text.toLowerCase().includes(target));
    return match || null;
  }

  function pickBooleanOption(options, boolValue) {
    const candidates = boolToYesNo(boolValue);
    if (!candidates.length) return null;
    return options.find((o) =>
      candidates.some((c) => o.text.toLowerCase().trim() === c || o.value.toLowerCase().trim() === c)
    ) || null;
  }

  function runAutofill(profile) {
    const fields = window.JobApplyDetector.detectFields(document);
    const summary = { filled: [], skipped: [], unknown: [], fileFields: [], errors: [] };

    for (const field of fields) {
     try {
      if (field.kind === "file") {
        window.JobApplyDom.highlight(field.element, "review");
        summary.fileFields.push({ label: field.signals.labelText || field.signals.name || "file upload" });
        continue;
      }

      const { semanticField, confidence } = window.JobApplyClassifier.classifyField(field.signals);

      if (!semanticField || confidence < CONFIDENCE_THRESHOLD) {
        window.JobApplyDom.highlight(field.kind === "radio-group" ? field.elements[0] : field.element, "unknown");
        summary.unknown.push({ label: field.signals.labelText || field.signals.name || field.signals.id || "(unlabeled)" });
        continue;
      }

      const isEeo = ["race", "gender", "veteranStatus", "disability"].includes(semanticField);
      if (isEeo && !profile.enableEeoAutofill) {
        window.JobApplyDom.highlight(field.kind === "radio-group" ? field.elements[0] : field.element, "review");
        summary.skipped.push({ label: semanticField, reason: "EEO field — opt-in disabled" });
        continue;
      }

      const profileValue = profile[semanticField];
      const hasValue = profileValue !== "" && profileValue !== null && profileValue !== undefined;

      if (field.kind === "text") {
        if (!hasValue) {
          window.JobApplyDom.highlight(field.element, "review");
          summary.skipped.push({ label: semanticField, reason: "no profile value" });
          continue;
        }
        if (field.element.value && field.element.value !== String(profileValue)) {
          // Don't silently overwrite a value the user (or a previous step) already entered.
          window.JobApplyDom.highlight(field.element, "review");
          summary.skipped.push({ label: semanticField, reason: "existing value present" });
          continue;
        }
        window.JobApplyDom.setNativeValue(field.element, String(profileValue));
        window.JobApplyDom.highlight(field.element, "filled");
        summary.filled.push({ label: semanticField, confidence });
      }

      if (field.kind === "select") {
        const match = typeof profileValue === "boolean"
          ? pickBooleanOption(field.options, profileValue)
          : pickSelectOption(field.options, profileValue);
        if (!match) {
          window.JobApplyDom.highlight(field.element, "review");
          summary.skipped.push({ label: semanticField, reason: "no matching option" });
          continue;
        }
        window.JobApplyDom.setNativeValue(field.element, match.value);
        window.JobApplyDom.highlight(field.element, "filled");
        summary.filled.push({ label: semanticField, confidence });
      }

      if (field.kind === "radio-group") {
        const match = typeof profileValue === "boolean"
          ? pickBooleanOption(field.options, profileValue)
          : pickSelectOption(field.options, profileValue);
        if (!match) {
          window.JobApplyDom.highlight(field.elements[0], "review");
          summary.skipped.push({ label: semanticField, reason: "no matching option" });
          continue;
        }
        const targetEl = field.elements.find((el) => el.value === match.value);
        if (targetEl) {
          window.JobApplyDom.setChecked(targetEl, true);
          window.JobApplyDom.highlight(targetEl, "filled");
          summary.filled.push({ label: semanticField, confidence });
        }
      }
     } catch (err) {
      console.warn("[JobApplyAutofill] skipped a field during fill:", err);
      summary.errors.push(String(err));
     }
    }

    return summary;
  }

  function undoAutofill() {
    document.querySelectorAll("[data-jobapply-highlighted]").forEach((el) => {
      window.JobApplyDom.clearHighlight(el);
    });
    // Note: this clears highlighting; it intentionally does not blank values,
    // since the user may have already edited them further.
  }

  window.JobApplyAutofill = { runAutofill, undoAutofill, CONFIDENCE_THRESHOLD };
})();
