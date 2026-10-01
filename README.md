# JobApply Autofill (MVP — Phase 1 & 2, partial Phase 5)

A Chrome Manifest V3 extension that detects and fills common job application
fields. It never clicks Submit/Apply/Next for you.

## v0.7.0 — Remove extra resume-parsed entries

Workday's "Autofill with Resume" step can parse MORE jobs/schools/languages
out of an uploaded resume than the user keeps in their saved profile (e.g.
an old internship they don't want on this application) — these showed up as
extra "Professional Experience N" / "Education N" / "Languages N" blocks
beyond what the saved profile has entries for.

- New popup button, **"Remove Extra Entries"**, with an inline confirmation
  panel (not a native `confirm()` dialog — those are unreliable inside an
  extension popup, which is a small, easily-defocused window). Clicking
  through it finds every rendered block whose number is beyond the saved
  profile's entry count for that section, and clicks that block's own
  "Delete"/"Remove" button, highest-numbered block first so earlier
  deletions can't shift the numbering out from under a later one. If the
  page raises its own confirmation prompt for a delete, the user still
  confirms that themselves — we don't try to auto-dismiss it.
- This is a separate, deliberate action from Fill Application, never done
  automatically as a side effect of a normal fill. An ordinary Fill now
  does flag when extra entries exist (`N extra workExperience entries
  beyond your saved profile — use "Remove Extra Entries" to delete them`),
  but doesn't delete anything on its own.
- Fixed a related bug surfaced while building this: a section's own bare
  heading ("Education", with no number) matches the same pattern as its
  first numbered block ("Education 1"), both resolving to entry #1 — so
  every section was being double-counted by one. Harmless for filling
  (both resolve to the same entry index), but it broke the new cleanup
  logic (duplicate "block" entries) and inflated the "N more entries aren't
  shown yet" counts. Fixed by de-duplicating headings that resolve to the
  same section + entry number, keeping the more specific (later, numbered)
  one.

## v0.6.0 — Fix repeated-section misassignment; override resume-parsed values

Two related bugs, both in the Workday-style repeated-section logic
(Professional Experience N / Education N / Languages N):

**1. Fields inside a block could be assigned the wrong local field.**
Each field's section-local key (`jobTitle`, `company`, `location`, …) was
being matched against `nearbyText` on equal footing with the field's own
label — and `nearbyText` walks up several ancestor levels, which inside a
tightly-packed block picks up **every sibling field's label text too**, not
just the field's own. In practice this meant most or all fields in a block
could resolve to the same local key (usually whichever key happened to be
checked first), scrambling where values landed. Fixed by matching a field's
own label/placeholder/aria-label first, and falling back to the (noisy)
`nearbyText` only if none of a field's own signals match anything. Also
fixed the `language` select's pattern, which was fully anchored
(`^...$`) and so could never match its own label (a `<select>`'s label text
includes its rendered option list) — and separately fixed a case where a
loosened version of that same pattern could match the unrelated "I am
fluent in this language" checkbox label instead.

**2. Workday's "Autofill with Resume" step pre-fills these same boxes.**
When Workday parses an uploaded resume, it fills Professional
Experience/Education blocks with its own guess *before* our extension runs.
Previously, our "don't clobber an existing value that looks different"
safety check (meant to protect fields the user had already typed into)
also applied here — so if Workday's resume parse didn't exactly match the
profile's saved entry, we left Workday's guess in place and just flagged it
for manual review instead of actually filling it. For these specific
repeated-section fields only, the saved profile entry is exactly what the
user maintains it for, so it now wins: a mismatched existing value is
cleared and overwritten rather than skipped. Ordinary flat fields (name,
email, phone, etc.) are unaffected and keep the original cautious
behavior — if the page already filled one in correctly, it's left alone;
if it's filled in with something that looks different, it's still flagged
for review rather than silently overwritten.

## v0.5.0 — Custom dropdown ("combobox") filling

Workday and similar ATS UIs often render a "select"-like field as a
`<button aria-haspopup="listbox">` instead of a native `<select>` — clicking
it opens a floating (often portaled-to-`<body>`) list of `role="option"`
elements, and the real value lives in a hidden input the widget manages
itself. These were previously detected but always flagged "needs manual
review." Now the extension actually drives them:

- Clicks the button to open the menu.
- Waits (up to 1.5s, polling via `requestAnimationFrame`) for visible
  `role="option"` elements to render — looking first inside whatever element
  the button's `aria-controls`/`aria-owns` points to, then falling back to
  any visible options on the page, since these widgets commonly portal the
  listbox elsewhere in the DOM rather than nesting it under the button.
- Matches an option by exact text, then by substring, against the profile
  value (e.g. `profile.country`).
- Clicks the matching option via simulated pointer/mouse events, which
  triggers the widget's own state update (button label + hidden input) —
  we never try to set the hidden input's value directly, since that value
  is an opaque id the widget itself assigns.
- Falls back safely to the existing "needs manual review" flag — and closes
  the menu (Escape) rather than leaving it open — if the menu never opens or
  no option matches the profile value.
- If the button already displays the correct value, it's left untouched
  and marked filled, same as the "already correct" logic for text fields.
- New test page: `test-pages/custom-combobox.html`, which mimics Workday's
  Country/Territory widget (button + portaled listbox + hidden input, with
  an artificial render delay) for testing this without a live site.

## v0.4.0 — Per-site permissions instead of `<all_urls>`

The extension no longer requests host access to every website at install
time. Instead:

- `manifest.json` declares `optional_host_permissions: ["<all_urls>"]`
  instead of `host_permissions: ["<all_urls>"]`, and there's no static
  `content_scripts` block anymore.
- The first time you click the extension icon on a site, the popup checks
  whether it already has permission for that site's origin(s) — including
  any iframe origins the page embeds (via `chrome.webNavigation.getAllFrames`,
  which doesn't itself require host access).
- If not granted, the popup shows an **"Enable on this site"** button. That
  click triggers `chrome.permissions.request(...)` scoped to just that
  site's origin(s) — never all sites at once.
- Once granted, the content script is injected into the already-open tab
  immediately, and the background service worker registers it dynamically
  (`chrome.scripting.registerContentScripts`) so it keeps auto-running on
  later page loads within that same site — this is what keeps multi-page
  session tracking (Step 2 of 4, etc.) working without re-prompting on every
  step.
- Revoking the permission from `chrome://extensions` is respected: the
  background worker listens for `chrome.permissions.onRemoved` and
  unregisters the content script for that origin.

**Trade-off to know about:** since there's no more background content
script running on every page by default, the toolbar badge and "in
progress" session line only populate once you've granted the site
permission — they no longer appear ambiently on a site you haven't used the
extension on yet. This is expected, not a bug.

## v0.3.0 — Repeated section support

Added handling for Workday-style forms that ask for prior experience,
education, and languages as their own numbered blocks ("Professional
Experience 1", "Professional Experience 2", "Education 1", "Languages 1", …)
instead of one flat field.

- New profile collections: `workExperience[]`, `education[]`, `languages[]`
  — manage them from the Options page (add/remove entries).
- New `src/content/section-detector.js`: finds these headings on the page,
  figures out where each numbered block starts/ends, and maps each block's
  fields to the matching profile array entry by position (block 2 → array
  index 1).
- If your profile has more saved entries than are currently rendered as
  blocks, the extension does **not** click "Add Another" for you — it
  highlights that button and tells you in the fill summary.
- New test page: `test-pages/workday-style-sections.html`.

## v0.2.0 — Iframe support + defensive error handling

- Content script injects into every frame of a page (`all_frames: true`),
  so embedded ATS widgets are detected and filled, not just the top-level
  document. The popup enumerates all frames of the active tab via
  `chrome.webNavigation.getAllFrames` and merges SCAN/FILL results.
- Field detection, classification, and filling are wrapped in try/catch at
  the per-field level, so one unusual element can't abort the whole
  scan/fill or break the host page.
- New test page: `test-pages/iframe-host.html` + `iframe-widget.html`.

## What's implemented

- Profile storage + settings page (`options/`)
- Field detection (text, textarea, select, radio groups, checkboxes, file inputs)
- Semantic classification with confidence scoring (deterministic keyword matching, no AI/network calls)
- Autofill engine with framework-safe value setting (native property setter + `input`/`change` events, so React/Vue-style controlled inputs pick up the value)
- Field highlighting (green = filled, yellow = needs review, gray dashed = unknown)
- Iframe-aware detection and filling
- Repeated-section detection for Workday-style multi-entry blocks
- Custom dropdown ("button + listbox") widget filling, e.g. Workday's Country/Territory field
- Basic multi-page session tracking (badge + step counter across page navigations)
- Test pages: basic form, React-controlled inputs, 3-page multi-step flow, iframe-embedded ATS widget, Workday-style repeated sections

## Not yet implemented

- ATS-specific adapters (Workday/Greenhouse/etc.) beyond generic + section detection
- Application tracker dashboard
- Resume/cover-letter file attachment assistance beyond highlighting the field
- Real EEO field patterns (the opt-in toggle exists; no patterns are wired into the classifier yet)

## Folder structure

```
job-apply-autofill/
├── manifest.json
├── src/
│   ├── background/service-worker.js
│   ├── content/ (dom-utils, field-detector, field-classifier, section-detector, autofill-engine, mutation-observer, content.js)
│   ├── profile/ (schema, storage)
│   └── popup/ (popup.html/js/css)
├── options/ (options.html/js/css)
└── test-pages/
```

## Loading in Chrome

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Pin the extension, open Settings to fill in your profile, then test
   against the pages in `test-pages/`
