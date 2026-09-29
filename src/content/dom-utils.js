// dom-utils.js
// Low-level helpers for reading and writing form field values safely,
// including the "native setter" trick needed for React-controlled inputs.

(function () {
  function getLabelText(el) {
    if (el.id) {
      const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (forLabel) return forLabel.textContent.trim();
    }
    const parentLabel = el.closest("label");
    if (parentLabel) return parentLabel.textContent.replace(el.value || "", "").trim();
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim())
        .filter(Boolean);
      if (parts.length) return parts.join(" ");
    }
    return "";
  }

  function getNearbyText(el, maxHops = 3) {
    let node = el.parentElement;
    let hops = 0;
    const seen = [];
    while (node && hops < maxHops) {
      const clone = node.cloneNode(true);
      clone.querySelectorAll("input, textarea, select, button").forEach((n) => n.remove());
      const text = clone.textContent.replace(/\s+/g, " ").trim();
      if (text) seen.push(text);
      node = node.parentElement;
      hops++;
    }
    return seen.join(" | ").slice(0, 300);
  }

  function collectSignals(el) {
    return {
      tag: el.tagName.toLowerCase(),
      type: (el.getAttribute("type") || "").toLowerCase(),
      name: el.getAttribute("name") || "",
      id: el.id || "",
      placeholder: el.getAttribute("placeholder") || "",
      ariaLabel: el.getAttribute("aria-label") || "",
      autocomplete: el.getAttribute("autocomplete") || "",
      labelText: getLabelText(el),
      nearbyText: getNearbyText(el)
    };
  }

  function setNativeValue(el, value) {
    const tag = el.tagName.toLowerCase();
    const proto = tag === "textarea" ? window.HTMLTextAreaElement.prototype
      : tag === "select" ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setChecked(el, checked) {
    const proto = window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "checked");
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, checked);
    } else {
      el.checked = checked;
    }
    el.dispatchEvent(new Event("click", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function highlight(el, kind) {
    el.style.outline = kind === "filled" ? "2px solid #22c55e"
      : kind === "review" ? "2px solid #eab308"
      : "2px dashed #94a3b8";
    el.style.outlineOffset = "1px";
    el.dataset.jobapplyHighlighted = kind;
  }

  function clearHighlight(el) {
    el.style.outline = "";
    el.style.outlineOffset = "";
    delete el.dataset.jobapplyHighlighted;
  }

  window.JobApplyDom = {
    getLabelText,
    getNearbyText,
    collectSignals,
    setNativeValue,
    setChecked,
    highlight,
    clearHighlight
  };
})();
