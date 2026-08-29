import { useEffect, useState } from "react";
import { api } from "./api";
import ProfileForm from "./ProfileForm";
import type { FieldMap, InboxItem, Job, JobEvent, View } from "./types";

const NAV: Array<{ id: View; label: string }> = [
  { id: "queue", label: "Queue" },
  { id: "applied", label: "Applied" },
  { id: "review", label: "Needs review" },
  { id: "failed", label: "Failed" },
  { id: "profile", label: "Profile" },
  { id: "inbox", label: "Unanswered" },
  { id: "answers", label: "Answer bank" },
  { id: "settings", label: "Settings" },
];

const FILTER: Record<string, string | undefined> = {
  queue: "queued,fetching,ready,filling,review,skipped",
  applied: "submitted",
  review: "review",
  failed: "failed",
};

function favicon(company: string, url: string) {
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
  } catch {
    return `https://www.google.com/s2/favicons?domain=${company}.com&sz=32`;
  }
}

function Chip({ status }: { status: Job["status"] }) {
  return <span className={`chip ${status}`}>{status}</span>;
}

export default function App() {
  const [view, setView] = useState<View>("queue");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [paste, setPaste] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ job: Job; events: JobEvent[]; fields: FieldMap[] } | null>(null);
  const [question, setQuestion] = useState<{ jobId: string; question: string; draft: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [inboxCount, setInboxCount] = useState(0);

  async function refresh() {
    const status = FILTER[view];
    setJobs(await api.jobs(status));
  }

  useEffect(() => {
    void refresh();
  }, [view]);

  async function refreshInboxCount() {
    try {
      const r = await api.inbox();
      setInboxCount(r.pendingCount);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void refreshInboxCount();
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as { type: string; jobId?: string; question?: string; draft?: string };
        if (data.type === "status" || data.type === "done" || data.type === "log" || data.type === "field" || data.type === "screenshot") {
          void refresh();
          if (openId && data.jobId === openId) void loadDetail(openId);
        }
        if (data.type === "inbox" || data.type === "done") {
          void refreshInboxCount();
        }
        if (data.type === "question" && data.jobId && data.question) {
          setQuestion({ jobId: data.jobId, question: data.question, draft: data.draft ?? "" });
          setDraft(data.draft ?? "");
        }
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, [openId, view]);

  async function loadDetail(id: string) {
    const d = await api.job(id);
    setDetail({ job: d.job, events: d.events, fields: d.fields });
  }

  useEffect(() => {
    if (openId) void loadDetail(openId);
  }, [openId]);

  const counts = { queue: jobs.length };

  async function add() {
    if (!paste.trim()) return;
    await api.addJobs(paste);
    setPaste("");
    await refresh();
  }

  const tableViews = view === "queue" || view === "applied" || view === "review" || view === "failed";

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          JOB 9k <span>/ local</span>
        </div>
        {NAV.map((n) => (
          <button key={n.id} className={`nav-btn ${view === n.id ? "active" : ""}`} onClick={() => setView(n.id)}>
            {n.label}
            {n.id === "inbox" && inboxCount > 0 ? <span className="nav-count">{inboxCount}</span> : null}
            {n.id === view && tableViews ? <span className="nav-count">{counts.queue}</span> : null}
          </button>
        ))}
        <div className="sidebar-foot">Review before submit. Data stays on this machine.</div>
      </aside>
      <div className="main">
        <div className="main-col">
          {tableViews && (
            <>
              <div className="topbar">
                <textarea
                  placeholder="Paste apply URLs, one per line"
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                />
                <div className="btn-row">
                  <button className="btn primary" onClick={() => void add()}>
                    Add to queue
                  </button>
                  <button className="btn" onClick={() => void api.runNext().then(refresh)}>
                    Run next
                  </button>
                  <button
                    className="btn"
                    onClick={() => void api.runSelected([...selected]).then(refresh)}
                    disabled={selected.size === 0}
                  >
                    Run selected
                  </button>
                </div>
              </div>
              <QueueTable
                jobs={jobs}
                selected={selected}
                openId={openId}
                onOpen={(id) => setOpenId(id)}
                onSelect={(id, on) => {
                  const next = new Set(selected);
                  if (on) next.add(id);
                  else next.delete(id);
                  setSelected(next);
                }}
                onSelectAll={(on) => setSelected(on ? new Set(jobs.map((j) => j.id)) : new Set())}
                onRefresh={refresh}
              />
            </>
          )}
          {view === "profile" && <ProfileForm />}
          {view === "inbox" && <InboxPage onCount={setInboxCount} />}
          {view === "answers" && <AnswersPage />}
          {view === "settings" && <SettingsPage />}
        </div>
        {openId && detail && tableViews && (
          <Drawer
            detail={detail}
            onClose={() => setOpenId(null)}
            onRefresh={() => void loadDetail(openId)}
          />
        )}
      </div>
      {question && (
        <div className="modal-back">
          <div className="modal">
            <h2>Unknown question</h2>
            <p>{question.question}</p>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="modal-actions">
              <button
                className="btn danger"
                onClick={() => {
                  void api.resolve(question.jobId, "skip");
                  setQuestion(null);
                }}
              >
                Skip job
              </button>
              <button
                className="btn"
                onClick={() => {
                  void api.resolve(question.jobId, "leave");
                  setQuestion(null);
                }}
              >
                Leave blank
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  void api.resolve(question.jobId, "edit", draft);
                  setQuestion(null);
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function QueueTable(props: {
  jobs: Job[];
  selected: Set<string>;
  openId: string | null;
  onOpen: (id: string) => void;
  onSelect: (id: string, on: boolean) => void;
  onSelectAll: (on: boolean) => void;
  onRefresh: () => Promise<void>;
}) {
  const { jobs, selected, openId, onOpen, onSelect, onSelectAll, onRefresh } = props;
  if (jobs.length === 0) return <div className="empty">No jobs in this view. Paste URLs above.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                checked={selected.size === jobs.length && jobs.length > 0}
                onChange={(e) => onSelectAll(e.target.checked)}
              />
            </th>
            <th>Company</th>
            <th>Role</th>
            <th>ATS</th>
            <th>Fit</th>
            <th>Status</th>
            <th>Note</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id} className={openId === job.id ? "selected" : ""} onClick={() => onOpen(job.id)}>
              <td onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={selected.has(job.id)} onChange={(e) => onSelect(job.id, e.target.checked)} />
              </td>
              <td>
                <div className="company">
                  <img src={favicon(job.company, job.url)} alt="" />
                  {job.company || "—"}
                </div>
              </td>
              <td>{job.title || <span className="muted">—</span>}</td>
              <td>
                <span className="badge">{job.ats}</span>
              </td>
              <td>{job.fitScore ?? "—"}</td>
              <td>
                <Chip status={job.status} />
              </td>
              <td className="note" title={job.lastError || job.note}>
                {job.lastError || job.note || ""}
              </td>
              <td className="actions" onClick={(e) => e.stopPropagation()}>
                <a className="btn ghost" href={job.applyUrl || job.url} target="_blank" rel="noreferrer">
                  Open
                </a>
                <button className="btn" onClick={() => void api.fill(job.id, false).then(onRefresh)}>
                  Fill
                </button>
                <button
                  className="btn danger"
                  title="Fill and submit. Greenhouse/Lever only, and only if Settings allow it."
                  onClick={() => {
                    if (confirm("Fill and submit this job? Default is still blocked unless auto-submit is enabled for this ATS.")) {
                      void api.fill(job.id, true).then(onRefresh);
                    }
                  }}
                >
                  Fill+submit
                </button>
                <button className="btn" onClick={() => void api.skip(job.id).then(onRefresh)}>
                  Skip
                </button>
                <button className="btn" onClick={() => void api.deleteJob(job.id).then(onRefresh)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Drawer({
  detail,
  onClose,
  onRefresh,
}: {
  detail: { job: Job; events: JobEvent[]; fields: FieldMap[] };
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { job, events, fields } = detail;
  const filling = job.status === "filling" || job.status === "review";
  return (
    <aside className="drawer">
      <button className="btn ghost" onClick={onClose}>
        Close
      </button>
      <h2>{job.title || "Untitled role"}</h2>
      <div className="meta">
        {job.company} · {job.ats} · <Chip status={job.status} />
      </div>
      {filling && (
        <div className="actions" style={{ marginBottom: 12 }}>
          <button className="btn" onClick={() => void api.pause(job.id, true).then(onRefresh)}>
            Pause
          </button>
          <button className="btn" onClick={() => void api.pause(job.id, false).then(onRefresh)}>
            Resume
          </button>
          <button className="btn danger" onClick={() => void api.takeover(job.id).then(onRefresh)}>
            Take over
          </button>
        </div>
      )}
      <div className="section">
        <h3>JD snippet</h3>
        <div className="jd">{job.jdSnippet || "Will fetch on Fill."}</div>
      </div>
      <div className="section">
        <h3>Apply URL</h3>
        <a href={job.applyUrl || job.url} target="_blank" rel="noreferrer">
          {job.applyUrl || job.url}
        </a>
      </div>
      <div className="section">
        <h3>Mapped fields</h3>
        {fields.length === 0 && <div className="muted">None yet.</div>}
        {fields.map((f) => (
          <div className="field-row" key={f.id}>
            <span className={`dot ${f.confidence}`} />
            <span>{f.label}</span>
            <span className="muted">{f.confidence}</span>
          </div>
        ))}
        {fields.some((f) => f.confidence === "blocked") && (
          <div className="muted" style={{ marginTop: 8 }}>
            Blocked questions are copied to Unanswered so you can answer them once.
          </div>
        )}
      </div>
      <div className="section">
        <h3>Resume</h3>
        <div className="muted">{job.resumePath || "Profile default"}</div>
      </div>
      {job.screenshotPath && (
        <div className="section">
          <h3>Screenshot</h3>
          <img className="shot" src={`/api/screenshots/${job.id}?t=${job.updatedAt}`} alt="run screenshot" />
        </div>
      )}
      <div className="section">
        <h3>Activity</h3>
        <div className="log">
          {events.map((e) => (
            <div key={e.id} className={e.level}>
              {e.ts.slice(11, 19)} {e.message}
            </div>
          ))}
        </div>
      </div>
      <label className="toggle">
        <input
          type="checkbox"
          checked={job.autoSubmit}
          onChange={(e) => void api.patchJob(job.id, { autoSubmit: e.target.checked } as Partial<Job>).then(onRefresh)}
        />
        Auto-submit this job (still requires Settings allowlist)
      </label>
    </aside>
  );
}

function ChoicePicker({
  choices,
  value,
  onPick,
}: {
  choices: string[];
  value: string;
  onPick: (v: string) => void;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const filtered = query ? choices.filter((c) => c.toLowerCase().includes(query)) : choices;
  const shown = filtered.slice(0, 40);
  return (
    <div className="choice-wrap">
      {choices.length > 12 ? (
        <input
          className="choice-filter"
          placeholder={`Filter ${choices.length} options from the form`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      ) : (
        <div className="muted" style={{ marginBottom: 6 }}>
          Options from the form — click to save
        </div>
      )}
      <div className="choice-list">
        {shown.map((c) => (
          <button key={c} type="button" className={`choice ${value === c ? "selected" : ""}`} onClick={() => onPick(c)}>
            {c}
          </button>
        ))}
      </div>
      {filtered.length > shown.length ? (
        <div className="muted">Showing {shown.length} of {filtered.length}. Type to filter.</div>
      ) : null}
    </div>
  );
}

function InboxPage({ onCount }: { onCount: (n: number) => void }) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  async function load() {
    const r = await api.inbox();
    setItems(r.items);
    onCount(r.pendingCount);
    setDrafts({});
  }

  useEffect(() => {
    void load();
  }, []);

  function applyResult(r: { items: InboxItem[]; pendingCount: number }, clearDrafts = true) {
    setItems(r.items);
    onCount(r.pendingCount);
    const keys = new Set(r.items.map((i) => i.key));
    setDrafts((d) => (clearDrafts ? {} : Object.fromEntries(Object.entries(d).filter(([k]) => keys.has(k)))));
  }

  const filled = Object.fromEntries(Object.entries(drafts).filter(([, v]) => v.trim()));

  return (
    <div className="page">
      <h1>Unanswered</h1>
      <p className="muted">
        Blocked form questions land here. If the field was a dropdown, pick the exact option the form listed. Skip hides
        a question so it is not asked again. Fill the job once more if a question has no options yet.
      </p>
      {items.length === 0 ? (
        <div className="empty">No unanswered questions. Run a fill and blocked fields will show up here.</div>
      ) : (
        <>
          <div className="btn-row" style={{ flexDirection: "row", marginBottom: 12, minWidth: 0 }}>
            <button
              className="btn primary"
              disabled={Object.keys(filled).length === 0}
              onClick={() => {
                void api.answerInbox(filled).then((r) => {
                  applyResult(r);
                  setMsg(`Saved ${Object.keys(filled).length}`);
                });
              }}
            >
              Save filled
            </button>
            <span className="muted" style={{ alignSelf: "center" }}>
              {items.length} waiting{msg ? ` · ${msg}` : ""}
            </span>
          </div>
          {items.map((item) => (
            <div className="card inbox-card" key={item.key}>
              <div className="inbox-head">
                <h2>{item.label}</h2>
                <div className="inbox-meta">
                  {item.required ? <span className="chip failed">required</span> : <span className="chip">optional</span>}
                  {item.choices?.length ? <span className="chip queued">{item.choices.length} options</span> : null}
                  {item.lastCompany ? <span className="muted">{item.lastCompany}</span> : null}
                  {item.seen > 1 ? <span className="muted">seen {item.seen}×</span> : null}
                </div>
              </div>
              {item.choices?.length ? (
                <ChoicePicker
                  choices={item.choices}
                  value={drafts[item.key] ?? ""}
                  onPick={(v) => {
                    setDrafts({ ...drafts, [item.key]: v });
                    void api.answerInbox({ [item.key]: v }).then((r) => {
                      applyResult(r, false);
                      setMsg(`Saved “${v}”`);
                    });
                  }}
                />
              ) : null}
              <textarea
                placeholder={item.choices?.length ? "Or type a custom answer" : "Answer as the form expects it"}
                value={drafts[item.key] ?? ""}
                onChange={(e) => setDrafts({ ...drafts, [item.key]: e.target.value })}
              />
              <div className="inbox-actions">
                <button
                  className="btn primary"
                  disabled={!(drafts[item.key] ?? "").trim()}
                  onClick={() => {
                    void api.answerInbox({ [item.key]: drafts[item.key] }).then((r) => {
                      applyResult(r);
                      setMsg("Saved");
                    });
                  }}
                >
                  Save
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    void api.dismissInbox([item.key]).then((r) => {
                      applyResult(r);
                      setMsg("Skipped");
                    });
                  }}
                >
                  Skip
                </button>
                {item.lastUrl ? (
                  <a className="btn ghost" href={item.lastUrl} target="_blank" rel="noreferrer">
                    Form
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function AnswersPage() {
  const [raw, setRaw] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    void api.answers().then((p) => setRaw(JSON.stringify(p, null, 2)));
  }, []);
  return (
    <div className="page">
      <h1>Answer bank</h1>
      <p className="muted">Keys fuzzy-match form labels. Salary / sponsorship / years / clearance must live here or in the profile — they are never guessed.</p>
      <textarea style={{ width: "100%", minHeight: 420, background: "#14181e", border: "1px solid #1f2630", borderRadius: 8, padding: 12 }} value={raw} onChange={(e) => setRaw(e.target.value)} />
      <div style={{ marginTop: 10 }}>
        <button
          className="btn primary"
          onClick={() => {
            try {
              void api.saveAnswers(JSON.parse(raw)).then(() => setMsg("Saved"));
            } catch {
              setMsg("Invalid JSON");
            }
          }}
        >
          Save
        </button>
        <span className="muted" style={{ marginLeft: 8 }}>
          {msg}
        </span>
      </div>
    </div>
  );
}

function SettingsPage() {
  const [raw, setRaw] = useState("");
  const [msg, setMsg] = useState("");
  const [otpEnabled, setOtpEnabled] = useState(false);
  const [otpEmail, setOtpEmail] = useState("");
  const [otpPassword, setOtpPassword] = useState("");
  const [wdEmail, setWdEmail] = useState("");
  const [wdPassword, setWdPassword] = useState("");

  useEffect(() => {
    void api.settings().then((p) => {
      const s = p as {
        otp?: { enabled?: boolean; email?: string; app_password?: string };
        accounts?: { workday?: { email?: string; password?: string } };
      };
      setOtpEnabled(Boolean(s.otp?.enabled));
      setOtpEmail(s.otp?.email ?? "");
      setOtpPassword(s.otp?.app_password ?? "");
      setWdEmail(s.accounts?.workday?.email ?? "");
      setWdPassword(s.accounts?.workday?.password ?? "");
      const copy = { ...s };
      setRaw(JSON.stringify(copy, null, 2));
    });
  }, []);

  function save() {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      void api
        .saveSettings({
          ...parsed,
          otp: {
            ...((parsed.otp as object) ?? {}),
            enabled: otpEnabled,
            email: otpEmail,
            app_password: otpPassword,
          },
          accounts: {
            workday: { email: wdEmail, password: wdPassword },
          },
        })
        .then((saved) => {
          setRaw(JSON.stringify(saved, null, 2));
          const s = saved as { otp?: { app_password?: string }; accounts?: { workday?: { password?: string } } };
          setOtpPassword(s.otp?.app_password ?? "");
          setWdPassword(s.accounts?.workday?.password ?? "");
          setMsg("Saved");
        });
    } catch {
      setMsg("Invalid JSON");
    }
  }

  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="muted">
        Auto-submit stays off. Credentials stay on this machine in data/settings.yml (gitignored). API responses mask
        passwords as ********.
      </p>

      <div className="card">
        <h2>Gmail OTP</h2>
        <p className="muted">
          For Workday login / create-account codes. Use a Gmail App Password, not your normal password. Generate one at
          myaccount.google.com/apppasswords.
        </p>
        <label className="toggle" style={{ margin: "8px 0 12px" }}>
          <input type="checkbox" checked={otpEnabled} onChange={(e) => setOtpEnabled(e.target.checked)} />
          Pull verification codes from Gmail
        </label>
        <div className="grid">
          <div className="field">
            <label>Gmail address</label>
            <input value={otpEmail} onChange={(e) => setOtpEmail(e.target.value)} autoComplete="off" />
          </div>
          <div className="field">
            <label>App password</label>
            <input
              type="password"
              value={otpPassword}
              onChange={(e) => setOtpPassword(e.target.value)}
              placeholder="leave ******** to keep"
              autoComplete="new-password"
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Workday account</h2>
        <p className="muted">Used to sign in or create an account, then the fill continues. Leave blank to pause for you.</p>
        <div className="grid">
          <div className="field">
            <label>Workday email</label>
            <input value={wdEmail} onChange={(e) => setWdEmail(e.target.value)} autoComplete="off" />
          </div>
          <div className="field">
            <label>Workday password</label>
            <input
              type="password"
              value={wdPassword}
              onChange={(e) => setWdPassword(e.target.value)}
              placeholder="leave ******** to keep"
              autoComplete="new-password"
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Advanced</h2>
        <p className="muted">Browser, LLM, auto-submit allowlist. Auto-submit enabled: false unless you change it here.</p>
        <textarea style={{ width: "100%", minHeight: 280, background: "#14181e", border: "1px solid #1f2630", borderRadius: 8, padding: 12 }} value={raw} onChange={(e) => setRaw(e.target.value)} />
      </div>
      <div style={{ marginTop: 10 }}>
        <button className="btn primary" onClick={save}>
          Save
        </button>
        <span className="muted" style={{ marginLeft: 8 }}>
          {msg}
        </span>
      </div>
    </div>
  );
}
