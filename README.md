# JobApply Autofill (MVP — Phase 1 & 2, partial Phase 5)

## v0.2.0 changes

- **Iframe support**: the content script now injects into every frame of a
  page (`all_frames: true`), so embedded ATS widgets (common on custom
  career pages using iCIMS/SmartRecruiters-style embeds) are now detected
  and filled, not just the top-level document. The popup enumerates all
  frames of the active tab via `chrome.webNavigation.getAllFrames` and
  merges SCAN/FILL results across them.
- **Defensive error handling**: field detection, classification, and filling
  are now wrapped in try/catch at the per-field level, so one unusual
  element on a messy real-world ATS page can't abort the whole scan/fill or
  break the host page. Background-script messaging also tolerates the
  extension being reloaded mid-session ("context invalidated" errors).
- New test page: `test-pages/iframe-host.html` + `iframe-widget.html`
  simulate a company careers page embedding a third-party ATS form in an
  iframe — use this to confirm the fix actually works before/after.


A Chrome Manifest V3 extension that detects and fills common job application
fields. It never clicks Submit/Apply/Next for you.

## What's implemented in this build

- Profile storage + settings page (`options/`)
- Field detection (text, textarea, select, radio groups, checkboxes, file inputs)
- Semantic classification with confidence scoring (deterministic keyword matching, no AI/network calls)
- Autofill engine with framework-safe value setting (native property setter + `input`/`change` events, so React/Vue-style controlled inputs pick up the value)
- Field highlighting (green = filled, yellow = needs review, gray dashed = unknown)
- Basic multi-page session tracking: the background service worker remembers
  which pages of a domain you've visited and shows a badge count of fillable
  fields per page; the popup shows "step" progress when it detects more than
  one page visited on the same domain
- Test pages simulating a single-page form, a 3-page multi-step flow, and a
  React-style controlled-input form

## Not yet implemented (see the full spec / later phases)

- ATS-specific adapters (Workday/Greenhouse/etc.) — generic detection only for now
- Application tracker dashboard
- Resume/cover-letter file attachment assistance beyond highlighting the field
- Export/import is implemented; EEO opt-in toggle is implemented but there's no EEO field pattern wired into the classifier yet (add patterns to `field-classifier.js` if you need it)

## Folder structure

```
job-apply-autofill/
├── manifest.json
├── src/
│   ├── background/service-worker.js
│   ├── content/ (detector, classifier, autofill engine, dom utils, observer, content.js)
│   ├── profile/ (schema, storage)
│   └── popup/ (popup.html/js/css)
├── options/ (options.html/js/css)
└── test-pages/ (basic-form.html, react-style.html, multi-step/step1-3.html)
```

See the chat for step-by-step instructions on loading this in Chrome and testing it.
