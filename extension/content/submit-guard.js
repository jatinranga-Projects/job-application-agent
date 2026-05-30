// Intercepts the final Submit/Apply button until the user confirms in the side panel.
// "Next" / "Continue" / "Save" are not blocked — multi-page flows still work.

(function () {
  if (window.__jobFillSubmitGuardInstalled) return;
  window.__jobFillSubmitGuardInstalled = true;

  // Disarmed until the side panel scans this tab — otherwise we'd block submits on every site.
  let armed = false;
  let confirmed = false;

  const SUBMIT_RE = /\b(submit|apply|send application|finish application)\b/i;
  const ADVANCE_RE = /\b(next|continue|save|review)\b/i;

  function looksLikeFinalSubmit(el) {
    if (!el) return false;
    if (el.type === "submit" && SUBMIT_RE.test(el.value || el.textContent || "")) return true;
    const text = (el.textContent || el.value || "").trim();
    if (!text) return false;
    if (ADVANCE_RE.test(text)) return false;
    return SUBMIT_RE.test(text);
  }

  document.addEventListener("click", (e) => {
    if (!armed || confirmed) return;
    const btn = e.target.closest("button, input[type=submit], [role=button]");
    if (!looksLikeFinalSubmit(btn)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    chrome.runtime.sendMessage({
      type: "JOBFILL_SUBMIT_INTERCEPTED",
      url: location.href,
      buttonText: (btn.textContent || btn.value || "").trim(),
    });
  }, true);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "JOBFILL_SUBMIT_RELEASE") {
      confirmed = true;
      sendResponse({ ok: true });
      // Re-click is left to user — they can hit the button again now that the guard is disarmed.
      return true;
    }
    if (msg?.type === "JOBFILL_SUBMIT_ARM") {
      armed = true;
      confirmed = false;
      sendResponse({ ok: true });
      return true;
    }
  });
})();
