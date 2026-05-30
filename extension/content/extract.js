// Walks the current page's forms and emits a Field[] array.
// Runs in the page's content script context. Activated by a message from the side panel.

(function () {
  if (window.__jobFillExtractorInstalled) return;
  window.__jobFillExtractorInstalled = true;

  function visible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none";
  }

  function labelText(el) {
    // <label for=id>
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab && lab.textContent.trim()) return lab.textContent.trim();
    }
    // aria-labelledby
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/).map(id => {
        const n = document.getElementById(id);
        return n ? n.textContent.trim() : "";
      }).filter(Boolean);
      if (parts.length) return parts.join(" ");
    }
    // aria-label
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    // wrapping <label>
    const wrap = el.closest("label");
    if (wrap) {
      const clone = wrap.cloneNode(true);
      clone.querySelectorAll("input,select,textarea").forEach(n => n.remove());
      const t = clone.textContent.trim();
      if (t) return t;
    }
    // closest preceding text in form-group container
    const group = el.closest(".form-group, .field, [class*='field'], [class*='question'], fieldset, div");
    if (group) {
      const heading = group.querySelector("label, legend, [class*='label'], [class*='question']");
      if (heading && heading.textContent.trim()) return heading.textContent.trim().slice(0, 200);
    }
    // placeholder fallback
    return el.getAttribute("placeholder") || el.getAttribute("name") || "";
  }

  function sectionContext(el) {
    const headings = [];
    let node = el;
    while (node && node !== document.body) {
      const h = node.querySelector?.(":scope > h1, :scope > h2, :scope > h3, :scope > legend");
      if (h) headings.unshift(h.textContent.trim());
      node = node.parentElement;
    }
    return headings.slice(-2).join(" > ");
  }

  function stableSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
    // indexed path fallback
    const path = [];
    let n = el;
    while (n && n.nodeType === 1 && n !== document.body) {
      const parent = n.parentElement;
      if (!parent) break;
      const siblings = Array.from(parent.children).filter(c => c.tagName === n.tagName);
      const idx = siblings.indexOf(n) + 1;
      path.unshift(`${n.tagName.toLowerCase()}:nth-of-type(${idx})`);
      n = parent;
    }
    return path.join(" > ");
  }

  function describeOptions(el) {
    if (el.tagName === "SELECT") {
      return Array.from(el.options).map(o => o.textContent.trim()).filter(Boolean);
    }
    return null;
  }

  function radioGroup(name) {
    const items = Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`));
    return items.map(r => ({
      value: r.value,
      label: labelText(r),
      checked: r.checked,
      selector: stableSelector(r),
    }));
  }

  function extractAll() {
    const fields = [];
    const seenRadioGroups = new Set();

    const candidates = document.querySelectorAll(
      "input, select, textarea, [role='combobox'], [contenteditable='true']"
    );

    for (const el of candidates) {
      if (!visible(el)) continue;
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute("type") || tag).toLowerCase();

      if (type === "hidden" || type === "submit" || type === "button" || type === "file") continue;

      if (type === "radio") {
        const name = el.name;
        if (!name || seenRadioGroups.has(name)) continue;
        seenRadioGroups.add(name);
        const options = radioGroup(name);
        fields.push({
          kind: "radio",
          name,
          label: labelText(el),
          section: sectionContext(el),
          required: el.required,
          options,
          currentValue: options.find(o => o.checked)?.value || null,
        });
        continue;
      }

      if (type === "checkbox") {
        fields.push({
          kind: "checkbox",
          selector: stableSelector(el),
          name: el.name || null,
          label: labelText(el),
          section: sectionContext(el),
          required: el.required,
          currentValue: el.checked,
        });
        continue;
      }

      fields.push({
        kind: tag === "select" ? "select"
            : el.getAttribute("role") === "combobox" ? "combobox"
            : tag === "textarea" ? "textarea"
            : el.getAttribute("contenteditable") === "true" ? "contenteditable"
            : "input",
        type,
        selector: stableSelector(el),
        name: el.name || null,
        label: labelText(el),
        section: sectionContext(el),
        placeholder: el.getAttribute("placeholder") || null,
        required: el.required || el.getAttribute("aria-required") === "true",
        options: describeOptions(el),
        currentValue: el.value || (el.textContent || "").trim() || null,
      });
    }

    return {
      url: location.href,
      title: document.title,
      pageHeading: document.querySelector("h1")?.textContent.trim() || null,
      fields,
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "JOBFILL_EXTRACT") {
      try {
        sendResponse({ ok: true, data: extractAll() });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return true;
    }
  });
})();
