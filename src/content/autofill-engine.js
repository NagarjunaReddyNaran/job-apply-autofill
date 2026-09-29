// autofill-engine.js
// Orchestrates: detect fields -> (section-aware or flat) classify -> resolve
// value from profile -> write value (framework-safe events) -> highlight ->
// summarize. Repeated blocks like "Professional Experience 2" or
// "Education 1" are matched against profile.workExperience[1] /
// profile.education[0] by their position among same-type blocks on the page.

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

  function writeValue(field, rawValue, label, confidence, summary) {
    const hasValue = rawValue !== "" && rawValue !== null && rawValue !== undefined;

    if (field.kind === "text") {
      if (!hasValue) {
        window.JobApplyDom.highlight(field.element, "review");
        summary.skipped.push({ label, reason: "no profile value" });
        return;
      }
      if (field.element.value && field.element.value !== String(rawValue)) {
        window.JobApplyDom.highlight(field.element, "review");
        summary.skipped.push({ label, reason: "existing value present" });
        return;
      }
      window.JobApplyDom.setNativeValue(field.element, String(rawValue));
      window.JobApplyDom.highlight(field.element, "filled");
      summary.filled.push({ label, confidence });
      return;
    }

    if (field.kind === "checkbox") {
      if (typeof rawValue !== "boolean") {
        window.JobApplyDom.highlight(field.element, "review");
        summary.skipped.push({ label, reason: "no profile value" });
        return;
      }
      window.JobApplyDom.setChecked(field.element, rawValue);
      window.JobApplyDom.highlight(field.element, "filled");
      summary.filled.push({ label, confidence });
      return;
    }

    if (field.kind === "select") {
      const match = typeof rawValue === "boolean" ? pickBooleanOption(field.options, rawValue) : pickSelectOption(field.options, rawValue);
      if (!match) {
        window.JobApplyDom.highlight(field.element, "review");
        summary.skipped.push({ label, reason: hasValue ? "no matching option" : "no profile value" });
        return;
      }
      window.JobApplyDom.setNativeValue(field.element, match.value);
      window.JobApplyDom.highlight(field.element, "filled");
      summary.filled.push({ label, confidence });
      return;
    }

    if (field.kind === "radio-group") {
      const match = typeof rawValue === "boolean" ? pickBooleanOption(field.options, rawValue) : pickSelectOption(field.options, rawValue);
      if (!match) {
        window.JobApplyDom.highlight(field.elements[0], "review");
        summary.skipped.push({ label, reason: hasValue ? "no matching option" : "no profile value" });
        return;
      }
      const targetEl = field.elements.find((el) => el.value === match.value);
      if (targetEl) {
        window.JobApplyDom.setChecked(targetEl, true);
        window.JobApplyDom.highlight(targetEl, "filled");
        summary.filled.push({ label, confidence });
      }
    }
  }

  function runAutofill(profile) {
    const fields = window.JobApplyDetector.detectFields(document);
    const summary = { filled: [], skipped: [], unknown: [], fileFields: [], errors: [], sectionNotices: [] };

    let sections = { assignments: new Map(), blocksFound: {}, addAnotherButtons: {} };
    try {
      sections = window.JobApplySections.detectSections(document, fields);
    } catch (err) {
      console.warn("[JobApplyAutofill] section detection failed, falling back to flat fields only:", err);
    }

    for (const field of fields) {
      try {
        if (field.kind === "file") {
          window.JobApplyDom.highlight(field.element, "review");
          summary.fileFields.push({ label: field.signals.labelText || field.signals.name || "file upload" });
          continue;
        }

        const assignment = sections.assignments.get(field);

        if (assignment) {
          const entries = profile[assignment.sectionKey] || [];
          const entry = entries[assignment.entryIndex];
          const label = `${assignment.sectionKey} #${assignment.entryIndex + 1} — ${assignment.localKey}`;
          if (!entry) {
            window.JobApplyDom.highlight(field.kind === "radio-group" ? field.elements[0] : field.element, "review");
            summary.skipped.push({ label, reason: `no saved entry #${assignment.entryIndex + 1} in profile` });
            continue;
          }
          writeValue(field, entry[assignment.localKey], label, 0.9, summary);
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

        writeValue(field, profile[semanticField], semanticField, confidence, summary);
      } catch (err) {
        console.warn("[JobApplyAutofill] skipped a field during fill:", err);
        summary.errors.push(String(err));
      }
    }

    try {
      for (const sectionKey of ["workExperience", "education", "languages"]) {
        const savedCount = (profile[sectionKey] || []).length;
        const renderedNumbers = sections.blocksFound[sectionKey] || [];
        const renderedCount = renderedNumbers.length ? Math.max(...renderedNumbers) : 0;
        if (savedCount > renderedCount) {
          const missing = savedCount - renderedCount;
          summary.sectionNotices.push(
            `${missing} more saved ${sectionKey} ${missing === 1 ? "entry isn't" : "entries aren't"} shown yet — click "Add Another" under that section, then run Fill Application again.`
          );
          const btn = sections.addAnotherButtons[sectionKey];
          if (btn) window.JobApplyDom.highlight(btn, "review");
        }
      }
    } catch (err) {
      console.warn("[JobApplyAutofill] section-count check failed:", err);
    }

    return summary;
  }

  function undoAutofill() {
    document.querySelectorAll("[data-jobapply-highlighted]").forEach((el) => {
      window.JobApplyDom.clearHighlight(el);
    });
  }

  window.JobApplyAutofill = { runAutofill, undoAutofill, CONFIDENCE_THRESHOLD };
})();
