# Job 9k

Local-first job application workstation. You find the links. You paste them. The app detects the ATS, fills the form from your profile and resume, then **stops before Submit**.

This is not a LinkedIn hunter, not an Easy Apply scraper, and not a cloud service. Profile, resume, and answers stay on your machine.

## Warning

Automating applications can violate a site's terms of service and get accounts restricted. You are responsible for how you use this. The default is **review-before-submit**. Do not mass-submit to unknown sites.

## What it does

1. Paste one or many apply URLs (Greenhouse, Lever, Ashby, Workday, Gem, iCIMS, SmartRecruiters, or a company career page).
2. Queue stores company, title, ATS type, status.
3. Fill opens a real Chromium window, maps fields from `data/profile.yml` + `data/answers.yml`, uploads your resume, and pauses.
4. You click Submit in the browser (or enable auto-submit for Greenhouse/Lever only, and only when every required field mapped).
5. Result is logged: filled / submitted / needs review / failed, with a screenshot.

Human-in-the-loop is the default. It never invents work history. It never guesses knockout questions (work auth, sponsorship, years of experience, salary, clearance) — those come from the answer bank or the run pauses.

## Setup

Requires **Node 22+** (uses the built-in `node:sqlite` driver so there is no native compile step).

```bash
git clone https://github.com/giuseppegaliazzitx-bit/Job_9k.git
cd Job_9k
npm install
npm run setup
```

`setup` copies:

- `data/profile.example.yml` → `data/profile.yml`
- `data/answers.example.yml` → `data/answers.yml`
- `data/settings.example.yml` → `data/settings.yml`

Edit `data/profile.yml`, drop a PDF at `data/resumes/resume.pdf`, then:

```bash
npm run dev
```

UI: http://localhost:5173  
API: http://localhost:8787

Chromium is installed via Playwright on `npm install`. Headed mode is the default.

### Optional: Gmail OTP + Workday login

In **Settings** (or `data/settings.yml`):

1. Enable OTP and paste a [Gmail App Password](https://myaccount.google.com/apppasswords) (not your normal Gmail password).
2. Store Workday email + password if you want the fill to sign in or create an account instead of pausing.

Codes are pulled over IMAP (`imap.gmail.com`) and typed into the open browser. Auto-submit stays **off** unless you turn it on.

## Daily use

1. Fill Profile and Answer bank.
2. Paste apply URLs into the queue (newline-separated).
3. **Run next** or **Fill** on a row. A Chromium window opens and fills the form.
4. Review the mapped-field checklist (green filled / amber guessed / red blocked).
5. Blocked questions are copied into **Unanswered** (and empty keys in `data/answers.yml`). Dropdowns include the form's option list — click the exact choice. Fill them once; later jobs reuse the answers.
6. Click Submit yourself in the browser.
7. Failed runs keep a screenshot under `data/screenshots/`.

Fill+submit is dangerous. It only fires when Settings → auto-submit is enabled, the ATS is on the allowlist (Greenhouse/Lever in v1), and no required field is blocked.

## Layout

```
apps/web          UI (Vite + React)
apps/api          local Express server
packages/core     queue, profile, ATS detect, SQLite, jsonl log
packages/adapters greenhouse, lever, ashby, workday, gem, icims, generic
packages/agent    Playwright persistent context + optional LLM fallback
data/             sqlite, profile.yml, answers.yml, question-inbox.yml, resumes/, screenshots/
```

SQLite: `data/queue.db`  
Application log: `data/applications.jsonl` (`url`, `ats`, `timestamp`, `status`, `fields_filled`, `fields_blocked`, `screenshot_path`)

Playwright uses a persistent context at `data/browser-profile/` so Workday cookies survive.

## Adapters

Detection is URL first (`greenhouse.io`, `myworkdayjobs.com`, `lever.co`, `ashbyhq.com`, `gem.com`, `icims.com`, `smartrecruiters.com`), then DOM fingerprints.

| ATS | Fill | Auto-submit in v1 |
| --- | --- | --- |
| Greenhouse | Scan → map → fill → verify. React select, intl-tel, custom questions | Allowed only if all required fields mapped |
| Lever | Same pipeline. Checkboxes/radios left for you (hCaptcha) | Allowed with the same required-field rule |
| Ashby | Typeahead + yes/no buttons. Warns if email already used | No |
| Workday | Login/create-account if credentials stored, then wizard. Stops before Submit | No |
| Gem / iCIMS / SmartRecruiters | Same scan/fill/verify as generic (iCIMS and SmartRecruiters are still best-effort) | No |
| Custom | Scan all standard inputs, then pause. LLM agent if configured | No |

We drive the **public apply page**. We do not POST the Greenhouse Job Board API with a board token.

### Add an adapter

1. Create `packages/adapters/src/yourats.ts` implementing `AtsAdapter`:

```ts
export const yourAdapter: AtsAdapter = {
  ats: "custom",
  allowsAutoSubmit: false,
  async detect(url, page) { /* URL or DOM */ return false; },
  async navigateToForm(page, url) { await page.goto(url); return page.url(); },
  async fill(ctx) { /* fill from ctx.profile / ctx.answers; never invent history */ return { outcomes: [] }; },
};
```

2. Register it in `packages/adapters/src/registry.ts` **above** `genericAdapter`.
3. Add URL patterns in `packages/core/src/detect.ts` and a test in `packages/core/src/detect.test.ts`.
4. Add a mocked HTML fixture under `data/fixtures/`.

`fill` must call `ctx.onField` as it goes. Knockout labels without an answer must call `ctx.onUnknownQuestion` or mark `blocked`.

## LLM (optional)

Settings → `llm.provider`:

- `none` (default) — no network calls for JD summary or unknown questions
- `openai-compatible` — SpaceXAI / xAI by default (`https://api.x.ai/v1`, model `grok-4.6`, env `XAI_API_KEY`)
- `anthropic` — set `ANTHROPIC_API_KEY`

Used for JD summary, unknown-question drafts, and the custom-site mapping fallback. Never used to invent employers, titles, or dates.

## Tests

```bash
npm test
```

Unit tests cover ATS URL detection, HTML fingerprints, paste parsing, and knockout mapping. Adapter traces can be recorded later; do not spam Submit against live boards in CI.

Fixture URLs (headed dry-run only): `data/fixtures/urls.txt`

## Out of scope (v1)

LinkedIn Easy Apply, Indeed/ZipRecruiter hunting, cloud sync, captcha-solving services, mass unattended submit.

## License

MIT
