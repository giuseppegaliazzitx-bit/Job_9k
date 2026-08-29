import { useEffect, useState } from "react";
import { api } from "./api";
import ProfileForm from "./ProfileForm";
import type { FieldMap, Job, JobEvent, View } from "./types";

const NAV: Array<{ id: View; label: string }> = [
  { id: "queue", label: "Queue" },
  { id: "applied", label: "Applied" },
  { id: "review", label: "Needs review" },
  { id: "failed", label: "Failed" },
  { id: "profile", label: "Profile" },
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

  async function refresh() {
    const status = FILTER[view];
    setJobs(await api.jobs(status));
  }

  useEffect(() => {
    void refresh();
  }, [view]);

  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as { type: string; jobId?: string; question?: string; draft?: string };
        if (data.type === "status" || data.type === "done" || data.type === "log" || data.type === "field" || data.type === "screenshot") {
          void refresh();
          if (openId && data.jobId === openId) void loadDetail(openId);
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
  useEffect(() => {
    void api.settings().then((p) => setRaw(JSON.stringify(p, null, 2)));
  }, []);
  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="muted">
        Headed browser is default. Auto-submit is off globally. LLM provider none | openai-compatible | anthropic. OpenAI-compatible defaults to SpaceXAI (api.x.ai, grok-4.6).
      </p>
      <textarea style={{ width: "100%", minHeight: 360, background: "#14181e", border: "1px solid #1f2630", borderRadius: 8, padding: 12 }} value={raw} onChange={(e) => setRaw(e.target.value)} />
      <div style={{ marginTop: 10 }}>
        <button
          className="btn primary"
          onClick={() => {
            try {
              void api.saveSettings(JSON.parse(raw)).then(() => setMsg("Saved"));
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
