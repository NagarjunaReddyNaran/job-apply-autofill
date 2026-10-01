// section-detector.js
// Detects Workday-style "repeated block" sections — Professional Experience 1,
// Professional Experience 2, Education 1, Languages 1, etc. — and figures out
// which detected field belongs to which numbered block, so it can be matched
// against the corresponding entry in profile.workExperience / .education / .languages.
//
// This module itself does NOT click any button -- it only detects headings,
// field assignments, and the Add/Add Another/Delete controls for each
// section. autofill-engine.js is what actually clicks them (adding blocks to
// match the saved profile's entry count, or removing extra ones), using what
// this module finds.

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
    const deduped = found
      .filter((f, i) => !found.some((other, j) => i !== j && other.element.contains(f.element) && other.element !== f.element))
      .sort((a, b) => (a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

    // A bare, un-numbered section heading ("Education") matches the same
    // heading pattern as a numbered one ("Education 1") with its number
    // defaulted to 1, since the (\d+)? group is optional -- that's needed so
    // a section with only ONE entry (no visible number at all) still gets
    // picked up. But when the page ALSO has an explicit "Education 1"
    // heading for its first block (common when a section header and a
    // per-entry header both exist), both resolve to the same (sectionKey,
    // entryNumber) pair and we'd otherwise double-count that block -- which
    // showed up as duplicated entries out of findDeletableBlocks(). Keep
    // only the LAST match for a given (sectionKey, entryNumber): the bare
    // section heading always comes first in document order (it's the
    // section's own title, before any of its numbered blocks), so the later
    // match is always the real, more specific per-block heading.
    const seen = new Map();
    deduped.forEach((h) => {
      seen.set(`${h.sectionKey}:${h.entryNumber}`, h);
    });
    return deduped.filter((h) => seen.get(`${h.sectionKey}:${h.entryNumber}`) === h);
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

      const fieldsInBlock = fields.filter((field) => {
        const anchorEl = field.kind === "radio-group" ? field.elements[0] : field.element;
        return isBetween(anchorEl, heading.element, nextHeading);
      });
      // A heading with NO fields under it isn't a rendered block -- it's
      // just the section's bare title before any entry has been added yet
      // (e.g. "Education" with only an "Add" button beneath it, zero
      // entries). The (\d+)? in the heading pattern is optional so a
      // single-entry section with no visible number still matches, but
      // that same bare match fires on an empty section too -- without this
      // check it would get counted as "1 block already there", which would
      // wrongly skip adding a block for a saved profile entry.
      if (!fieldsInBlock.length) return;

      blocksFound[heading.sectionKey].push(heading.entryNumber);

      for (const field of fieldsInBlock) {
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
        // A section with zero entries so far often labels its button plain
        // "Add" rather than "Add Another" (that label only shows up once at
        // least one entry already exists) -- match both.
        if (!/^add(\s+another)?\b/i.test(textOf(btn))) return;
        if (isBetween(btn, lastHeading, null) && !candidate) candidate = btn;
      });
      addAnotherButtons[def.key] = candidate;
    }

    return { assignments, blocksFound, addAnotherButtons };
  }

  // Finds rendered blocks that go BEYOND what the profile has saved for that
  // section (entryNumber > savedCounts[sectionKey]) -- the case where
  // Workday's "Autofill with Resume" step parsed more jobs/schools/languages
  // out of the resume than the user has chosen to keep in their saved
  // profile. For each such block, finds its own "Delete"/"Remove" button (if
  // any) so the caller can remove it and leave only the blocks that
  // correspond to a real saved profile entry. Sorted highest entryNumber
  // first, so deleting one block doesn't shift the DOM position (or
  // Workday's own re-numbering) of another block this function already
  // found, before the caller gets to it.
  function findDeletableBlocks(root, savedCounts) {
    const headings = findHeadings(root);
    const allButtons = Array.from(root.querySelectorAll("button, a, [role='button']"));
    const result = { workExperience: [], education: [], languages: [] };

    headings.forEach((heading, idx) => {
      const savedCount = savedCounts[heading.sectionKey] || 0;
      if (heading.entryNumber <= savedCount) return; // a saved profile entry maps here -- keep it

      const nextHeading = headings[idx + 1]?.element || null;
      let deleteButton = null;
      for (const btn of allButtons) {
        if (!/\b(delete|remove)\b/i.test(textOf(btn))) continue;
        if (isBetween(btn, heading.element, nextHeading)) {
          deleteButton = btn;
          break;
        }
      }
      result[heading.sectionKey].push({ entryNumber: heading.entryNumber, headingElement: heading.element, deleteButton });
    });

    for (const key of Object.keys(result)) {
      result[key].sort((a, b) => b.entryNumber - a.entryNumber);
    }
    return result;
  }

  window.JobApplySections = { detectSections, findDeletableBlocks, SECTION_DEFS };
})();
