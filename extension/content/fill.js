// Writes values back to form fields. Uses native setters so React's onChange fires.

(function () {
  if (window.__jobFillFillerInstalled) return;
  window.__jobFillFillerInstalled = true;

  function nativeSet(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findOptionByText(el, target) {
    const norm = s => String(s || "").trim().toLowerCase();
    const t = norm(target);
    return Array.from(el.options).find(o => norm(o.textContent) === t)
        || Array.from(el.options).find(o => norm(o.textContent).includes(t))
        || Array.from(el.options).find(o => norm(o.value) === t);
  }

  function fillSelect(el, value) {
    const opt = findOptionByText(el, value);
    if (!opt) return { ok: false, reason: "no matching option" };
    nativeSet(el, opt.value);
    return { ok: true, written: opt.textContent.trim() };
  }

  function fillRadio(name, value) {
    const items = Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`));
    const norm = s => String(s || "").trim().toLowerCase();
    const target = norm(value);
    const match = items.find(r => norm(r.value) === target)
               || items.find(r => norm(r.labels?.[0]?.textContent) === target)
               || items.find(r => norm(r.labels?.[0]?.textContent).includes(target));
    if (!match) return { ok: false, reason: "no matching radio" };
    match.click();
    return { ok: true, written: match.value };
  }

  function fillCheckbox(el, value) {
    const want = value === true || value === "true" || value === "yes" || value === 1;
    if (el.checked !== want) el.click();
    return { ok: true, written: el.checked };
  }

  function fillContentEditable(el, value) {
    el.focus();
    el.textContent = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    return { ok: true, written: value };
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Look for a rendered option matching `want` across common listbox patterns.
  function findRenderedOption(want) {
    const norm = s => String(s || "").trim().toLowerCase();
    const opts = Array.from(document.querySelectorAll(
      '[role="option"], .select__option, [class*="-option"], li[class*="option"]'
    )).filter(o => o.offsetParent !== null && o.textContent.trim());
    return opts.find(o => norm(o.textContent) === want)
        || opts.find(o => norm(o.textContent).includes(want));
  }

  // Open the widget, type to filter (if it accepts text), wait for the menu, click the match.
  async function fillCombobox(el, value) {
    const want = String(value || "").trim().toLowerCase();
    el.scrollIntoView({ block: "center" });
    el.focus();
    el.click();

    const typeable = el.tagName === "INPUT" || el.isContentEditable;
    if (typeable) {
      nativeSet(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // Poll for the menu to render (react-select etc. render options asynchronously).
    let option = null;
    for (let i = 0; i < 20 && !option; i++) {
      option = findRenderedOption(want);
      if (!option) await sleep(60);
    }
    if (option) {
      option.scrollIntoView({ block: "center" });
      option.click();
      return { ok: true, written: option.textContent.trim(), note: "combobox" };
    }

    // Fallback: keyboard select whatever the menu highlighted.
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    return { ok: false, reason: "no matching option appeared", note: "combobox best-effort" };
  }

  async function fillOne(row) {
    try {
      if ((row.value == null || row.value === "") && row.kind !== "checkbox") {
        return { ok: false, reason: "no value" };
      }
      if (row.kind === "radio") return fillRadio(row.name, row.value);
      const el = document.querySelector(row.selector);
      if (!el) return { ok: false, reason: "selector not found" };
      if (row.kind === "select") return fillSelect(el, row.value);
      if (row.kind === "checkbox") return fillCheckbox(el, row.value);
      if (row.kind === "contenteditable") return fillContentEditable(el, row.value);
      if (row.kind === "combobox") return await fillCombobox(el, row.value);
      nativeSet(el, row.value);
      return { ok: true, written: row.value };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "JOBFILL_FILL") {
      // Fill sequentially so we never have two dropdown menus open at once.
      (async () => {
        const results = [];
        for (const r of (msg.rows || [])) {
          results.push({ selector: r.selector || r.name, ...(await fillOne(r)) });
        }
        sendResponse({ ok: true, results });
      })();
      return true;
    }
  });
})();
