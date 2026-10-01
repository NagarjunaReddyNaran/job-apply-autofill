// section-detector.js
// Detects Workday-style "repeated block" sections — Professional Experience 1,
// Professional Experience 2, Education 1, Languages 1, etc. — and figures out
// which detected field belongs to which numbered block, so it can be matched
// against the corresponding entry in profile.workExperience / .education / .languages.
//
// This does NOT click "Add Another" or any other button. If the profile has
// more saved entries than are currently rendered as blocks, the autofill
// engine reports that separately so the user can add a block and re-run Fill.

(function () {
  const SECTION_DEFS = [
    {
      key: "workExperience",
      heading: /^(professional experience|work experience|employment( history)?)\s*(\d+)?$/i,
      patterns: {
        jobTitle: [/\bjob\s*title\b/i, /\bposition\s*(title)?\b/i, /^\s*title\s*\*?\s*$/i],
        company: [/\bcompany\b/i, /\bemployer\b/i],
        location: [/\blocation\b/i],
        current: [/\bcurrently\s*work\s*here\b/i, /\bi\s*currently\s*work\b/i, /\bcurrent\s*(role|position|job)\b/i],
        startDate: [/^\s*from\s*\*?\s*$/i, /\bstart\s*date\b/i],
        endDate: [/^\s*to\s*\*?\s*$/i, /\bend\s*date\b/i],
        description: [/\brole\s*description\b/i, /\bdescription\b/i, /\bresponsibilities\b/i]
      }
    },
    {
      key: "education",
      heading: /^education\s*(\d+)?$/i,
      patterns: {
        school: [/\bschool\s*(or)?\s*university\b/i, /\buniversity\b/i, /\bschool\b/i, /\binstitution\b/i],
        degree: [/\bdegree\b/i],
        fieldOfStudy: [/\bfield\s*of\s*study\b/i, /\bmajor\b/i, /\bconcentration\b/i]
      }
    },
    {
      key: "languages",
      heading: /^languages?\s*(\d+)?$/i,
      patterns: {
        // Anchored to the START only (not both ends): a <select>'s own
        // label text also includes its option list ("Language * Select One
        // English French Spanish …"), so a fully-anchored exact-match
        // pattern never matches it at all. But an unanchored /\blanguage\b/
        // is too loose the other way -- it also matches the "fluent"
        // checkbox's own label ("I am fluent in this language."), since
        // that sentence happens to contain the word "language" too, and
        // "language" is checked before "fluent" below. Anchoring to the
        // start keeps it matching the field's own label ("Language ...")
        // without matching a sentence that merely mentions the word.
        language: [/^\s*language\b/i],
        fluent: [/\bfluent\b/i],
        comprehension: [/\bcomprehension\b/i],
        overall: [/\boverall\b/i],
        reading: [/\breading\b/i],
        speaking: [/\bspeaking\b/i],
        writing: [/\bwriting\b/i]
      }
    }
  ];

  function textOf(el) {
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function findHeadings(root) {
    const candidates = root.querySelectorAll("h1, h2, h3, h4, h5, h6, legend, [role='heading'], strong, b, dt, div, span, p");
    const found = [];
    candidates.forEach((el) => {
      const text = textOf(el);
      if (!text || text.length > 60) return;
      for (const def of SECTION_DEFS) {
        const match = text.match(def.heading);
        if (match) {
          const entryNumber = match[match.length - 1] ? parseInt(match[match.length - 1], 10) : 1;
          found.push({ element: el, sectionKey: def.key, entryNumber, def });
          break;
        }
      }
    });
    return found
      .filter((f, i) => !found.some((other, j) => i !== j && other.element.contains(f.element) && other.element !== f.element))
      .sort((a, b) => (a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  }

  function isBetween(el, startEl, endEl) {
    const afterStart = !!(startEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (!afterStart) return false;
    if (!endEl) return true;
    const beforeEnd = !!(el.compareDocumentPosition(endEl) & Node.DOCUMENT_POSITION_FOLLOWING);
    return beforeEnd;
  }

  function detectSections(root, fields) {
    const headings = findHeadings(root);
    const assignments = new Map();
    const blocksFound = { workExperience: [], education: [], languages: [] };

    headings.forEach((heading, idx) => {
      const nextHeading = headings[idx + 1]?.element || null;
      blocksFound[heading.sectionKey].push(heading.entryNumber);

      for (const field of fields) {
        const anchorEl = field.kind === "radio-group" ? field.elements[0] : field.element;
        if (!isBetween(anchorEl, heading.element, nextHeading)) continue;

        // Match on the field's OWN label/placeholder/aria-label first.
        // nearbyText is deliberately excluded here: getNearbyText() walks up
        // several ancestor levels and, inside one of these tightly-packed
        // "entry" blocks, that walk picks up EVERY sibling field's label
        // text too -- not just this field's own. If we let nearbyText vote
        // on equal footing, a field like "Company" ends up with "Job Title"
        // in its signal text (from its neighbor) and can match the wrong
        // localKey before its own, correct, label is even considered. Only
        // fall back to nearbyText (low-confidence, whole-block context) if
        // none of the field's own direct signals match anything at all.
        const ownSignals = [field.signals.labelText, field.signals.placeholder, field.signals.ariaLabel].filter(Boolean);
        const fallbackSignals = [field.signals.nearbyText].filter(Boolean);
        let localKey = null;
        for (const [key, patterns] of Object.entries(heading.def.patterns)) {
          if (ownSignals.some((text) => patterns.some((p) => p.test(text)))) {
            localKey = key;
            break;
          }
        }
        if (!localKey) {
          for (const [key, patterns] of Object.entries(heading.def.patterns)) {
            if (fallbackSignals.some((text) => patterns.some((p) => p.test(text)))) {
              localKey = key;
              break;
            }
          }
        }
        if (localKey && !assignments.has(field)) {
          assignments.set(field, { sectionKey: heading.sectionKey, entryIndex: heading.entryNumber - 1, localKey });
        }
      }
    });

    const addAnotherButtons = {};
    const allButtons = root.querySelectorAll("button, a, [role='button']");
    for (const def of SECTION_DEFS) {
      const relevantHeadings = headings.filter((h) => h.sectionKey === def.key);
      if (!relevantHeadings.length) continue;
      const lastHeading = relevantHeadings[relevantHeadings.length - 1].element;
      let candidate = null;
      allButtons.forEach((btn) => {
        if (!/^add another\b/i.test(textOf(btn))) return;
        if (isBetween(btn, lastHeading, null) && !candidate) candidate = btn;
      });
      addAnotherButtons[def.key] = candidate;
    }

    return { assignments, blocksFound, addAnotherButtons };
  }

  window.JobApplySections = { detectSections, SECTION_DEFS };
})();
