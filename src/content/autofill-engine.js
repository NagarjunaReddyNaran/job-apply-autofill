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

  // --- Custom combobox ("button[aria-haspopup=listbox]") filling -----------
  //
  // These widgets (Workday's Country/Territory field and similar) aren't a
  // native <select> -- they're a <button> that, when clicked, renders a
  // floating listbox of role="option" elements elsewhere in the DOM, plus a
  // hidden input holding the real value. Driving one means: click the
  // button to open it, wait for the options to actually render (they're
  // inserted async, sometimes with a fade-in), find the option whose text
  // matches the profile value, and click that option. If anything along the
  // way doesn't look right -- the menu doesn't open, no option matches --
  // we back off, close the menu, and fall back to flagging for manual
  // review rather than leaving the widget in a half-open or wrong state.

  function isElementVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findListboxOptions(button) {
    // Prefer the listbox the button explicitly references, since some pages
    // render more than one floating listbox-like widget at a time.
    const refId = button.getAttribute("aria-controls") || button.getAttribute("aria-owns");
    if (refId) {
      const owned = document.getElementById(refId);
      if (owned) {
        const scoped = Array.from(owned.querySelectorAll("[role='option']"));
        if (scoped.length) return scoped.filter(isElementVisible);
      }
    }
    // Fall back to any visible role="option" elements on the page -- most
    // of these widgets portal their listbox to the end of <body>, so it
    // usually isn't a DOM descendant of the button.
    return Array.from(document.querySelectorAll("[role='option']")).filter(isElementVisible);
  }

  function dispatchClick(el) {
    const rect = el.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };
    // Some widgets listen on pointer/mouse down+up rather than just "click".
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
      try {
        el.dispatchEvent(new MouseEvent(type, opts));
      } catch {
        // MouseEvent unsupported for this type in this environment -- skip it.
      }
    });
  }

  function closeListbox(button) {
    try {
      button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    } catch {
      // ignore
    }
  }

  function waitForOptions(button, timeoutMs = 1500) {
    return new Promise((resolve) => {
      const start = performance.now();
      function check() {
        const options = findListboxOptions(button);
        if (options.length) {
          resolve(options);
          return;
        }
        if (performance.now() - start >= timeoutMs) {
          resolve([]);
          return;
        }
        requestAnimationFrame(check);
      }
      check();
    });
  }

  async function fillCustomCombobox(field, rawValue) {
    const button = field.element;
    const target = String(rawValue).trim().toLowerCase();
    if (!target) return { ok: false, reason: "no profile value" };

    // If the button's own label already shows this value (e.g. the page
    // defaulted it, or a previous run already set it), leave it alone.
    const currentText = (button.textContent || "").trim().toLowerCase();
    if (currentText && (currentText === target || currentText.includes(target))) {
      return { ok: true, alreadyCorrect: true };
    }

    dispatchClick(button);
    const options = await waitForOptions(button);

    if (!options.length) {
      closeListbox(button);
      return { ok: false, reason: "dropdown didn't open — please select manually" };
    }

    const optionText = (el) => el.textContent.trim().toLowerCase();
    let match = options.find((o) => optionText(o) === target);
    if (!match) match = options.find((o) => optionText(o).includes(target));

    if (!match) {
      closeListbox(button);
      return { ok: false, reason: "no matching option found in dropdown — please select manually" };
    }

    dispatchClick(match);
    // Give the widget a beat to update its button label / hidden input
    // before we move on to the next field.
    await new Promise((resolve) => setTimeout(resolve, 80));
    return { ok: true };
  }

  async function writeComboboxValue(field, rawValue, label, confidence, summary) {
    const hasValue = rawValue !== "" && rawValue !== null && rawValue !== undefined;
    if (!hasValue) {
      window.JobApplyDom.highlight(field.element, "review");
      summary.skipped.push({ label, reason: "no profile value" });
      return;
    }

    try {
      const result = await fillCustomCombobox(field, rawValue);
      if (result.ok) {
        window.JobApplyDom.highlight(field.element, "filled");
        summary.filled.push({ label, confidence });
      } else {
        window.JobApplyDom.highlight(field.element, "review");
        summary.skipped.push({ label, reason: result.reason || "custom dropdown widget — please select manually" });
      }
    } catch (err) {
      console.warn("[JobApplyAutofill] custom combobox fill failed:", err);
      window.JobApplyDom.highlight(field.element, "review");
      summary.skipped.push({ label, reason: "custom dropdown widget — please select manually" });
    }
  }

  function writeValue(field, rawValue, label, confidence, summary, opts = {}) {
    const { overwriteMismatched = false } = opts;
    const hasValue = rawValue !== "" && rawValue !== null && rawValue !== undefined;

    if (field.kind === "text") {
      if (!hasValue) {
        window.JobApplyDom.highlight(field.element, "review");
        summary.skipped.push({ label, reason: "no profile value" });
        return;
      }

      const existingRaw = field.element.value || "";
      // Compare loosely (trim + case-insensitive) so a value the SITE ITSELF
      // already filled in (e.g. Workday's own "autofill from resume" step)
      // that's effectively the same as our profile's value counts as
      // correctly filled, not a mismatch needing review.
      const normalize = (v) => String(v).trim().toLowerCase();
      if (existingRaw && normalize(existingRaw) !== normalize(rawValue)) {
        if (overwriteMismatched) {
          // Repeated-section fields (work history / education / languages)
          // are explicitly the fields the user maintains in their saved
          // profile for exactly this purpose -- and Workday's own "Autofill
          // with Resume" step commonly pre-fills these same boxes with its
          // own (often mis-parsed or mis-ordered) guess from the resume
          // file. Deferring to "existing value present" here means our
          // extension silently does nothing and the page's resume-parsed
          // guess is what ends up submitted -- which is the bug being
          // fixed. So for these fields specifically, the saved profile
          // entry wins: clear the field and write our value over it.
          window.JobApplyDom.setNativeValue(field.element, "");
          window.JobApplyDom.setNativeValue(field.element, String(rawValue));
          window.JobApplyDom.highlight(field.element, "filled");
          summary.filled.push({ label, confidence, note: "replaced resume-parsed value" });
          return;
        }
        window.JobApplyDom.highlight(field.element, "review");
        summary.skipped.push({ label, reason: "existing value present" });
        return;
      }
      if (existingRaw) {
        // Already there and already correct -- nothing to write.
        window.JobApplyDom.highlight(field.element, "filled");
        summary.filled.push({ label, confidence });
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

  async function runAutofill(profile) {
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
          if (field.kind === "custom-combobox") {
            await writeComboboxValue(field, entry[assignment.localKey], label, 0.9, summary);
          } else {
            // overwriteMismatched: true -- Workday's "Autofill with Resume"
            // step often pre-fills these exact boxes with its own parse of
            // the uploaded resume, which can be wrong, truncated, or placed
            // in a different block than our saved profile entry. The saved
            // profile is what the user maintains for this purpose, so it
            // takes priority over whatever the page guessed here.
            writeValue(field, entry[assignment.localKey], label, 0.9, summary, { overwriteMismatched: true });
          }
          continue;
        }

        const { semanticField, confidence } = window.JobApplyClassifier.classifyField(field.signals);

        if (!semanticField || confidence < CONFIDENCE_THRESHOLD) {
          const fallbackEl = field.kind === "radio-group" ? field.elements[0] : field.element;
          window.JobApplyDom.highlight(fallbackEl, "unknown");
          const unknownLabel = field.signals.labelText || field.signals.ariaLabel || field.signals.name || field.signals.id || "(unlabeled)";
          summary.unknown.push({ label: unknownLabel });
          continue;
        }

        const isEeo = ["race", "gender", "veteranStatus", "disability"].includes(semanticField);
        if (isEeo && !profile.enableEeoAutofill) {
          window.JobApplyDom.highlight(field.kind === "radio-group" ? field.elements[0] : field.element, "review");
          summary.skipped.push({ label: semanticField, reason: "EEO field — opt-in disabled" });
          continue;
        }

        if (field.kind === "custom-combobox") {
          await writeComboboxValue(field, profile[semanticField], semanticField, confidence, summary);
        } else {
          writeValue(field, profile[semanticField], semanticField, confidence, summary);
        }
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
