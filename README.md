# Job Application Auto-Fill

A Chrome extension that reads job-application forms on any website and fills them
from your saved profile using Google's **Gemini** model. It scans the visible
form fields, asks Gemini to map each field to the right value from your profile,
shows you the proposed answers for review, and fills them in with one click.

Everything runs locally in your browser. Your profile and API key never leave
your machine except for the single request your browser makes directly to the
Gemini API.

---

## Table of contents

- [Features](#features)
- [How it works](#how-it-works)
- [Installation](#installation)
- [Setup](#setup)
- [Usage](#usage)
- [Privacy & security](#privacy--security)
- [Project structure](#project-structure)
- [Profile format](#profile-format)
- [Limitations](#limitations)
- [Development notes](#development-notes)

---

## Features

- **Works on any site** — reads standard `input`, `select`, and `textarea`
  fields, including radio/checkbox groups.
- **Smart field matching** — Gemini matches form labels to your profile
  semantically (e.g. "Given name" → `firstName`, "Work authorization" →
  eligibility).
- **Review before filling** — proposed values appear in a side panel with a
  confidence score; you can edit any value before it's written to the page.
- **Framework-aware filling** — dispatches native `input`/`change`/`blur` events
  so React/Vue/Angular forms register the changes.
- **Submit guard** — warns you before a form is submitted so you always get a
  final review (it notifies, it does not hard-block).
- **Token & cost meter** — shows the Gemini token usage and approximate cost of
  each scan.
- **No data invention** — the prompt explicitly forbids fabricating emails,
  phone numbers, or IDs; unknown fields are left blank.

---

## How it works

The extension has four cooperating parts. Here's the flow for a single scan-and-fill:

```
 ┌─────────────┐   1. Scan      ┌──────────────────┐
 │  Side panel  │ ─────────────▶ │ content/extract.js│  reads form fields
 │ (panel.js)   │ ◀───────────── │  (page context)   │  → JSON list of fields
 └──────┬───────┘   fields JSON  └──────────────────┘
        │
        │ 2. Map fields (profile + fields)
        ▼
 ┌──────────────────┐  3. Gemini API call   ┌──────────────┐
 │  background.js    │ ────────────────────▶ │  Gemini 2.5  │
 │ (service worker)  │ ◀──────────────────── │    Flash      │
 └──────┬───────────┘   value mappings      └──────────────┘
        │
        │ 4. Render rows for review (you can edit)
        ▼
 ┌─────────────┐   5. Fill      ┌──────────────────┐
 │  Side panel  │ ─────────────▶ │  content/fill.js  │  writes values into
 │              │                │  (page context)   │  the form fields
 └─────────────┘                └──────────────────┘
```

1. **`content/extract.js`** runs in the page and collects every fillable field —
   its key, label (from `<label>`, `aria-label`, or placeholder), type, options,
   `required`, and `maxLength`. Hidden, file, password, and button fields are
   skipped; radio/checkbox groups are collapsed to one entry per group.
2. **`sidepanel/panel.js`** sends that list, plus your profile, to the background
   worker.
3. **`background.js`** (the service worker) loads the prompt from
   `prompts/field-map.md`, calls the Gemini API, and parses the JSON response
   into mapping rows (`{ key, value, confidence, label }`).
4. The side panel renders each proposed value in an editable row so you can
   review and correct anything.
5. When you click **Fill fields**, **`content/fill.js`** writes the values back
   into the page, firing the events frameworks need to see.
6. **`content/submit-guard.js`** listens for form submissions and warns you in
   the panel before anything is sent.

---

## Installation

This extension is **not** on the Chrome Web Store — you load it directly from the
source ("unpacked"). There is no build step.

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome (or any Chromium browser — Edge, Brave).
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the **`extension/`** folder.
5. The extension icon appears in your toolbar. Click it to open the side panel.

It stays installed across browser restarts and reboots. After editing any source
file, return to `chrome://extensions` and click the **reload ↻** icon on the
extension.

---

## Setup

You need a **Gemini API key** (free tier works):

1. Get a key from [Google AI Studio](https://aistudio.google.com/apikey).
2. Open the extension's side panel → **Settings**.
3. Paste your key into the **Gemini API key** field.
4. Add your **Profile JSON** — click **Load example** to start from a template
   (see [Profile format](#profile-format)), then edit it with your details.
5. Click **Save settings**.

Both the key and profile are stored in `chrome.storage.local` (this browser, this
machine only). You only do this once.

> **Tip:** set a usage/quota cap on your key in Google AI Studio so a runaway or
> leaked key can't run up charges.

---

## Usage

1. Open a job-application page.
2. Click the extension icon to open the side panel.
3. Click **Scan this page** — it extracts the fields and asks Gemini to map them.
4. Review the proposed values. Edit any of them inline. Low-confidence guesses
   are flagged with a score.
5. Click **Fill fields** to write the values into the form.
6. Keep **Warn before submit** checked to get a review prompt before the form is
   actually submitted.
7. Finish anything the tool left blank (file uploads, custom essays), then submit
   yourself.

---

## Privacy & security

- **Your data stays local.** The profile and API key live in
  `chrome.storage.local`, isolated per-extension — other extensions and websites
  cannot read them.
- **One outbound request.** The only network call is from your browser directly
  to the Gemini API (over HTTPS), carrying the prompt, your profile, and the page
  field list. Nothing is sent to any other server.
- **The page never sees your key.** The API key lives in the background worker,
  not in the content scripts injected into pages.
- **Nothing personal is in this repo.** `extension/profile/profile.json` (your
  real profile) and any `*.pdf` (resumes) are gitignored. The committed
  `profile.example.json` uses placeholder data.
- **Heads-up:** `chrome.storage.local` is not encrypted on disk, so anyone with
  access to your unlocked machine/user account could read the stored key. Treat
  the Gemini key as low-stakes and rotate it in AI Studio if you ever suspect it
  leaked.

---

## Project structure

```
extension/
├── manifest.json              # MV3 manifest, permissions, entry points
├── background.js              # Service worker: calls Gemini, brokers messages
├── icon.png
├── content/
│   ├── extract.js             # Reads fillable fields from the page
│   ├── fill.js                # Writes mapped values back into the form
│   └── submit-guard.js        # Warns before a form is submitted
├── sidepanel/
│   ├── panel.html             # Side-panel UI
│   └── panel.js               # UI logic, scan/fill orchestration, settings
├── prompts/
│   └── field-map.md           # The instruction prompt sent to Gemini
└── profile/
    ├── profile.example.json   # Template profile (placeholder data, committed)
    └── profile.json           # Your real profile (gitignored, local only)
```

**Permissions** (`manifest.json`): `activeTab`, `scripting`, `storage`,
`sidePanel`, `notifications`, and `<all_urls>` host access (so it can read and
fill forms on any job site).

---

## Profile format

The profile is a JSON object grouped into sections. See
[`extension/profile/profile.example.json`](extension/profile/profile.example.json)
for the full template. Top-level sections:

| Section         | What it holds                                              |
| --------------- | --------------------------------------------------------- |
| `personal`      | name, email, phone, address, LinkedIn, GitHub, portfolio  |
| `eligibility`   | work authorization, sponsorship, relocation, notice period|
| `experience`    | array of jobs (company, title, dates, achievements)       |
| `education`     | array of degrees (school, degree, field, dates, GPA)      |
| `skills`        | array of skills                                           |
| `compensation`  | current/expected salary, currency                         |
| `essays`        | reusable answers + a cover-letter template                |
| `preferences`   | tone for free-text fields                                 |

You don't have to fill every field — anything missing is simply left blank by the
form-filler.

---

## Limitations

- **The background service worker sleeps when idle.** This is normal Chrome MV3
  behavior — it wakes on demand (icon click, page events). It is not "broken."
- **File uploads aren't automated** (resume/cover-letter attachments). You attach
  those yourself.
- **Unusual or heavily custom widgets** (rich dropdowns, multi-step wizards,
  canvas-based inputs) may not be detected or filled reliably.
- **Gemini free-tier rate limits** can cause a scan to fail temporarily; retry
  after a moment.
- The extension **does not auto-submit** — that's intentional. You always review
  and submit yourself.

---

## Development notes

- **No build / no dependencies.** Plain JavaScript, Manifest V3. Edit a file and
  reload the extension.
- **Model & prompt** are configured in `background.js` (`GEMINI_MODEL`) and
  `prompts/field-map.md`. The prompt asks Gemini to return a strict JSON array;
  `background.js` includes a tolerant parser that strips code fences and recovers
  from minor formatting issues.
- **Message types** used between parts: `JOBFILL_EXTRACT`, `JOBFILL_MAP_FIELDS`,
  `JOBFILL_FILL`, `JOBFILL_SET_GUARD`, `JOBFILL_SUBMIT_INTERCEPTED`,
  `JOBFILL_SUBMIT_NOTIFY`.
- **Pricing meter** in `panel.js` uses Gemini 2.5 Flash rates; update the
  constants if you switch models.
