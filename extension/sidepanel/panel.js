const $ = id => document.getElementById(id);
let lastRows = []; // last LLM result rows, possibly edited inline

// Gemini 2.5 Flash pricing (USD per token).
const PRICE_IN = 0.30 / 1e6;
const PRICE_OUT = 2.50 / 1e6;
let sessionTokens = 0;
let sessionCost = 0;

function renderUsage(usage) {
  if (!usage) return;
  const inTok = usage.promptTokenCount || 0;
  const outTok = usage.candidatesTokenCount || 0;
  const cost = inTok * PRICE_IN + outTok * PRICE_OUT;
  sessionTokens += inTok + outTok;
  sessionCost += cost;
  $("usage").textContent =
    `This scan: ${inTok} in + ${outTok} out ≈ $${cost.toFixed(4)} · ` +
    `Session: ${sessionTokens} tok ≈ $${sessionCost.toFixed(4)}`;
}

function setStatus(s) { $("status").textContent = s; }
function showNotice(s) { const n = $("notice"); n.textContent = s; n.style.display = s ? "block" : "none"; }

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function loadSettings() {
  const { apiKey, profile } = await chrome.storage.local.get(["apiKey", "profile"]);
  if (apiKey) $("apiKey").value = apiKey;
  if (profile) $("profile").value = typeof profile === "string" ? profile : JSON.stringify(profile, null, 2);
}

$("save").onclick = async () => {
  const apiKey = $("apiKey").value.trim();
  const profileText = $("profile").value.trim();
  let profile = profileText;
  try { profile = JSON.parse(profileText); } catch { /* keep as string */ }
  await chrome.storage.local.set({ apiKey, profile });
  setStatus("Settings saved.");
};

$("loadExample").onclick = async () => {
  const res = await fetch(chrome.runtime.getURL("profile/profile.example.json"));
  $("profile").value = await res.text();
};

$("settings").onclick = () => {
  document.querySelector("details").open = true;
};

function renderRows(rows) {
  const root = $("results");
  root.innerHTML = "";
  if (!rows.length) {
    root.textContent = "No fields returned.";
    return;
  }
  rows.forEach((row, i) => {
    const div = document.createElement("div");
    div.className = "row";
    const conf = row.confidence || "unknown";
    div.innerHTML = `
      <div class="label">${escapeHtml(row.label || row.selector || row.name || "(field)")}
        <span class="badge ${conf}">${conf}</span>
        <span class="meta">${escapeHtml(row.source || "")}</span>
      </div>
      <div class="meta">${escapeHtml(row.selector || row.name || "")}</div>
    `;
    const input = document.createElement(row.kind === "textarea" || (row.value || "").length > 80 ? "textarea" : "input");
    if (input.tagName === "INPUT") input.type = "text";
    else input.rows = 4;
    input.value = row.value == null ? "" : String(row.value);
    input.oninput = () => { lastRows[i].value = input.value; lastRows[i].edited = true; };
    div.appendChild(input);
    if (row.note) {
      const n = document.createElement("div");
      n.className = "meta"; n.textContent = row.note;
      div.appendChild(n);
    }
    root.appendChild(div);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function sendOnce(tabId, message) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, message, resp => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(resp);
    });
  });
}

async function sendToTab(tabId, message) {
  let resp = await sendOnce(tabId, message);
  if (resp?.ok || !/Receiving end does not exist/i.test(resp?.error || "")) return resp;
  // Tab was open before the extension loaded — inject content scripts now and retry.
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: ["content/extract.js", "content/fill.js", "content/submit-guard.js"],
    });
  } catch (e) {
    return { ok: false, error: "Could not inject content scripts: " + e.message };
  }
  return sendOnce(tabId, message);
}

$("scan").onclick = async () => {
  setStatus("Extracting fields...");
  const tab = await activeTab();
  const ex = await sendToTab(tab.id, { type: "JOBFILL_EXTRACT" });
  if (!ex?.ok) { setStatus("Extract failed: " + (ex?.error || "no response")); return; }
  setStatus(`Got ${ex.data.fields.length} fields. Asking Gemini...`);

  const mapped = await chrome.runtime.sendMessage({ type: "JOBFILL_MAP_FIELDS", page: ex.data });
  if (!mapped?.ok) { setStatus("Map failed: " + mapped?.error); return; }
  renderUsage(mapped.usage);
  lastRows = mapped.rows;
  renderRows(lastRows);

  setStatus("Filling...");
  const fill = await sendToTab(tab.id, { type: "JOBFILL_FILL", rows: lastRows });
  // Arm the submit guard now that we've filled this tab.
  await sendToTab(tab.id, { type: "JOBFILL_SUBMIT_ARM" });
  setStatus(`Filled. Review fields below, then click "Apply edits" if you change any.`);
  if (fill?.results) {
    const failed = fill.results.filter(r => !r.ok);
    if (failed.length) showNotice(`${failed.length} field(s) could not be filled — see details below.`);
  }
};

$("apply").onclick = async () => {
  const tab = await activeTab();
  setStatus("Re-applying edits...");
  await sendToTab(tab.id, { type: "JOBFILL_FILL", rows: lastRows });
  setStatus("Done.");
};

// Set a dotted path (e.g. "profile.eligibility.workAuthorization") on an object.
function setPath(obj, path, value) {
  const keys = path.replace(/^profile\./, "").split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== "object") o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

$("saveEdits").onclick = async () => {
  const { profile } = await chrome.storage.local.get("profile");
  let obj = profile && typeof profile === "object" ? profile : {};
  if (typeof profile === "string") { try { obj = JSON.parse(profile); } catch { obj = {}; } }
  let n = 0;
  for (const row of lastRows) {
    if (!row.edited) continue;                           // only fields you typed into
    const path = row.savePath;
    if (!path || !/^profile\./.test(path)) continue;     // only known, profile-bound fields
    if (/\.\d+(\.|$)/.test(path)) continue;              // skip array paths (e.g. experience.0) to avoid corrupting lists
    if (row.value == null || row.value === "") continue;
    setPath(obj, path, row.value);
    row.edited = false;                                  // saved — don't re-save on next click
    n++;
  }
  if (!n) { setStatus("No edited fields to save."); return; }
  await chrome.storage.local.set({ profile: obj });
  $("profile").value = JSON.stringify(obj, null, 2);
  setStatus(`Saved ${n} edited field(s) to your profile.`);
};

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "JOBFILL_SUBMIT_NOTIFY") {
    showNotice(`Submit button ("${msg.buttonText}") was blocked. Review fields, then click the button again to submit.`);
    (async () => {
      const tab = await activeTab();
      await sendToTab(tab.id, { type: "JOBFILL_SUBMIT_RELEASE" });
    })();
  }
});

loadSettings();
