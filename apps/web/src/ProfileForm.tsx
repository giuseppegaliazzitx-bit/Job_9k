import { useEffect, useState } from "react";
import { api } from "./api";

type Profile = {
  identity: Record<string, string>;
  files: { resume: string; cover_letter: string };
  skills: string[];
  experience: {
    years: string;
    current_company: string;
    current_title: string;
    notice_period: string;
    salary_expectation: string;
    roles: Array<{ company: string; title: string; location: string; start: string; end: string; bullets: string[] }>;
  };
  education: Array<{ school: string; degree: string; major: string; start: string; end: string }>;
  eeo: Record<string, string>;
  work_auth: Record<string, string>;
  blacklist: string[];
};

function Field({ label, value, onChange, span }: { label: string; value: string; onChange: (v: string) => void; span?: boolean }) {
  return (
    <div className={`field ${span ? "span2" : ""}`}>
      <label>{label}</label>
      <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export default function ProfileForm() {
  const [p, setP] = useState<Profile | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void api.profile().then((raw) => setP(raw as Profile));
  }, []);

  if (!p) return <div className="page">Loading…</div>;

  const id = p.identity;
  const setId = (k: string, v: string) => setP({ ...p, identity: { ...id, [k]: v } });

  return (
    <div className="page">
      <h1>Profile</h1>
      <p className="muted">Also editable as data/profile.yml. Work auth and sponsorship are explicit yes/no — never inferred.</p>

      <div className="card">
        <h2>Identity</h2>
        <div className="grid">
          <Field label="First name" value={id.first_name} onChange={(v) => setId("first_name", v)} />
          <Field label="Last name" value={id.last_name} onChange={(v) => setId("last_name", v)} />
          <Field label="Preferred name" value={id.preferred_name} onChange={(v) => setId("preferred_name", v)} />
          <Field label="Email" value={id.email} onChange={(v) => setId("email", v)} />
          <Field label="Phone" value={id.phone} onChange={(v) => setId("phone", v)} />
          <Field label="Location" value={id.location} onChange={(v) => setId("location", v)} />
          <Field label="City" value={id.city} onChange={(v) => setId("city", v)} />
          <Field label="State" value={id.state} onChange={(v) => setId("state", v)} />
          <Field label="Postal code" value={id.postal_code} onChange={(v) => setId("postal_code", v)} />
          <Field label="Country" value={id.country} onChange={(v) => setId("country", v)} />
          <Field label="LinkedIn" value={id.linkedin} onChange={(v) => setId("linkedin", v)} />
          <Field label="GitHub" value={id.github} onChange={(v) => setId("github", v)} />
          <Field label="Portfolio" value={id.portfolio} onChange={(v) => setId("portfolio", v)} span />
          <Field label="Work authorized (Yes/No)" value={id.work_auth} onChange={(v) => setId("work_auth", v)} />
          <Field label="Sponsorship needed (Yes/No)" value={id.sponsorship_needed} onChange={(v) => setId("sponsorship_needed", v)} />
        </div>
      </div>

      <div className="card">
        <h2>Files</h2>
        <div className="grid">
          <Field label="Resume PDF path" value={p.files.resume} onChange={(v) => setP({ ...p, files: { ...p.files, resume: v } })} span />
          <Field label="Cover letter path" value={p.files.cover_letter} onChange={(v) => setP({ ...p, files: { ...p.files, cover_letter: v } })} span />
        </div>
      </div>

      <div className="card">
        <h2>Experience</h2>
        <div className="grid">
          <Field label="Years of experience" value={p.experience.years} onChange={(v) => setP({ ...p, experience: { ...p.experience, years: v } })} />
          <Field label="Current company" value={p.experience.current_company} onChange={(v) => setP({ ...p, experience: { ...p.experience, current_company: v } })} />
          <Field label="Current title" value={p.experience.current_title} onChange={(v) => setP({ ...p, experience: { ...p.experience, current_title: v } })} />
          <Field label="Notice period" value={p.experience.notice_period} onChange={(v) => setP({ ...p, experience: { ...p.experience, notice_period: v } })} />
          <Field label="Salary expectation (blank = pause)" value={p.experience.salary_expectation} onChange={(v) => setP({ ...p, experience: { ...p.experience, salary_expectation: v } })} />
          <Field label="Skills (comma-separated)" value={p.skills.join(", ")} onChange={(v) => setP({ ...p, skills: v.split(",").map((s) => s.trim()).filter(Boolean) })} span />
        </div>
        <p className="muted">Roles are structured JSON for Workday. Edit as JSON below if you need more than the first role.</p>
        <textarea
          style={{ width: "100%", minHeight: 120, background: "#0b0d10", border: "1px solid #1f2630", borderRadius: 8, padding: 8 }}
          value={JSON.stringify(p.experience.roles, null, 2)}
          onChange={(e) => {
            try {
              setP({ ...p, experience: { ...p.experience, roles: JSON.parse(e.target.value) } });
            } catch {
              /* keep typing */
            }
          }}
        />
      </div>

      <div className="card">
        <h2>Education</h2>
        <textarea
          style={{ width: "100%", minHeight: 100, background: "#0b0d10", border: "1px solid #1f2630", borderRadius: 8, padding: 8 }}
          value={JSON.stringify(p.education, null, 2)}
          onChange={(e) => {
            try {
              setP({ ...p, education: JSON.parse(e.target.value) });
            } catch {
              /* keep typing */
            }
          }}
        />
      </div>

      <div className="card">
        <h2>Blacklist</h2>
        <Field label="Companies (comma-separated)" value={p.blacklist.join(", ")} onChange={(v) => setP({ ...p, blacklist: v.split(",").map((s) => s.trim()).filter(Boolean) })} span />
      </div>

      <button
        className="btn primary"
        onClick={() => {
          void api.saveProfile(p).then(() => setMsg("Saved to data/profile.yml"));
        }}
      >
        Save profile
      </button>
      <span className="muted" style={{ marginLeft: 8 }}>
        {msg}
      </span>
    </div>
  );
}
