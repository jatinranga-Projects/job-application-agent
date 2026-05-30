// Service worker: opens side panel, calls Gemini, brokers messages between panel and content scripts.

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = (key) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id != null) await chrome.sidePanel.open({ tabId: tab.id });
});

async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(["apiKey", "profile"], resolve);
  });
}

async function loadPrompt() {
  const url = chrome.runtime.getURL("prompts/field-map.md");
  const res = await fetch(url);
  return res.text();
}

async function callGemini({ apiKey, system, userParts }) {
  const res = await fetch(GEMINI_URL(apiKey), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: userParts.map(t => ({ text: t })) }],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 65536,
        temperature: 0.2,
        // Disable thinking so the full token budget goes to the JSON, not reasoning.
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const cand = json.candidates?.[0];
  const text = (cand?.content?.parts || []).map(p => p.text || "").join("");
  if (!text) {
    const reason = cand?.finishReason || json.promptFeedback?.blockReason || "no content";
    throw new Error(`Gemini returned no text (finishReason: ${reason}).`);
  }
  return { text, usage: json.usageMetadata, finishReason: cand?.finishReason };
}

function parseJsonFromResponse(text) {
  // Strip markdown code fences if the model wrapped the JSON.
  const cleaned = text.replace(/^```(?:json)?/im, "").replace(/```\s*$/m, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  // Fallback: slice from the first bracket and shrink the end until it parses.
  const start = cleaned.search(/[\[{]/);
  if (start < 0) throw new Error("No JSON in response. Raw: " + text.slice(0, 300));
  for (let end = cleaned.length; end > start; end--) {
    try { return JSON.parse(cleaned.slice(start, end)); } catch {}
  }
  throw new Error("Could not parse JSON from response. Raw: " + text.slice(0, 300));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "JOBFILL_MAP_FIELDS") {
    (async () => {
      try {
        const { apiKey, profile } = await getSettings();
        if (!apiKey) throw new Error("No API key set. Open Settings.");
        if (!profile) throw new Error("No profile set. Open Settings.");
        const prompt = await loadPrompt();
        const profileJson = typeof profile === "string" ? profile : JSON.stringify(profile);
        const { text, usage } = await callGemini({
          apiKey,
          system: prompt,
          userParts: [
            "PROFILE JSON:\n" + profileJson,
            "PAGE:\n" + JSON.stringify({
              url: msg.page.url,
              title: msg.page.title,
              pageHeading: msg.page.pageHeading,
            }),
            "FIELDS:\n" + JSON.stringify(msg.page.fields, null, 2),
            "Return ONLY a JSON array of result rows as specified. No prose.",
          ],
        });
        const rows = parseJsonFromResponse(text);
        sendResponse({ ok: true, rows, usage });
      } catch (e) {
        sendResponse({ ok: false, error: String(e.message || e) });
      }
    })();
    return true;
  }

  if (msg?.type === "JOBFILL_SUBMIT_INTERCEPTED") {
    chrome.runtime.sendMessage({ type: "JOBFILL_SUBMIT_NOTIFY", url: msg.url, buttonText: msg.buttonText });
    chrome.notifications?.create?.({
      type: "basic",
      iconUrl: "icon.png",
      title: "Ready to submit?",
      message: `Application is ready. Open the side panel to confirm and submit "${msg.buttonText}".`,
    }, () => void chrome.runtime.lastError);
    return false;
  }
});
