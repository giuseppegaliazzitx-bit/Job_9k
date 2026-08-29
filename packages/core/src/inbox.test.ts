import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import yaml from "js-yaml";
import {
  answerInboxItems,
  captureBlockedFields,
  cleanBlockedLabel,
  collapseRepeatedPhrase,
  dismissInboxItems,
  listPendingInbox,
} from "./inbox.js";
import { lookupValue } from "./mapping.js";
import type { Profile } from "./types.js";

function tmpData(): string {
  const dir = mkdtempSync(join(tmpdir(), "job9k-inbox-"));
  writeFileSync(join(dir, "answers.yml"), "how_heard: Job Boards\nwebsite: \"\"\n", "utf8");
  return dir;
}

const profile = {
  identity: {
    first_name: "Jane",
    last_name: "Doe",
    preferred_name: "Jane",
    email: "j@example.com",
    phone: "555",
    phone_country: "",
    location: "SF",
    city: "SF",
    state: "CA",
    postal_code: "",
    address_line1: "",
    address_line2: "",
    country: "United States",
    linkedin: "",
    github: "",
    portfolio: "",
    work_auth: "Yes",
    sponsorship_needed: "No",
  },
  files: { resume: "", cover_letter: "" },
  skills: [],
  experience: {
    years: "5",
    current_company: "Acme",
    current_title: "Eng",
    notice_period: "2 weeks",
    salary_expectation: "",
    roles: [],
  },
  education: [],
  eeo: { gender: "", hispanic_latino: "", race: "", veteran_status: "", disability_status: "" },
  work_auth: {
    authorized_us: "Yes",
    sponsorship_needed: "No",
    visa_status: "",
    office_willing: "",
    willing_to_relocate: "",
    remote_preference: "",
  },
  blacklist: [],
} satisfies Profile;

describe("cleanBlockedLabel", () => {
  it("strips Greenhouse question ids and repeats", () => {
    expect(cleanBlockedLabel("question_31645096003 What is your strongest coding language?*")).toBe(
      "What is your strongest coding language?",
    );
    expect(cleanBlockedLabel("question_31645094003 Website/Portfolio Website/Portfolio Website/Portfolio")).toBe(
      "Website/Portfolio",
    );
    expect(cleanBlockedLabel('question_31645109003 If "Other", please explain: If "Other", please explain: If "Other", please explain:')).toBe(
      'If "Other", please explain:',
    );
  });

  it("strips ATS control prefixes", () => {
    expect(cleanBlockedLabel("degree--0 Degree*")).toBe("Degree");
    expect(cleanBlockedLabel("discipline--0 Discipline*")).toBe("Discipline");
    expect(cleanBlockedLabel("country Country*")).toBe("Country");
  });

  it("drops junk labels", () => {
    expect(cleanBlockedLabel("field")).toBeNull();
    expect(cleanBlockedLabel("Resume")).toBeNull();
    expect(cleanBlockedLabel("")).toBeNull();
  });
});

describe("collapseRepeatedPhrase", () => {
  it("collapses a copied label", () => {
    expect(collapseRepeatedPhrase("GPA (Undergraduate) GPA (Undergraduate)")).toBe("GPA (Undergraduate)");
  });
});

describe("captureBlockedFields", () => {
  it("adds cleaned empty keys to answers.yml and the inbox", () => {
    const dir = tmpData();
    const result = captureBlockedFields(
      [
        { label: "field", required: false, jobId: "j1" },
        { label: "question_31645096003 What is your strongest coding language?*", required: true, jobId: "j1", company: "Freeform" },
        { label: "question_31645097003 GPA (Undergraduate)*", required: true, jobId: "j1", company: "Freeform" },
        { label: "question_31645094003 Website/Portfolio Website/Portfolio Website/Portfolio", required: false, jobId: "j1" },
      ],
      dir,
    );

    expect(result.addedKeys).toContain("What is your strongest coding language?");
    expect(result.addedKeys).toContain("GPA (Undergraduate)");
    expect(result.addedKeys).not.toContain("field");
    expect(result.addedKeys).not.toContain("website");

    const answers = yaml.load(readFileSync(join(dir, "answers.yml"), "utf8")) as Record<string, string>;
    expect(answers["What is your strongest coding language?"]).toBe("");
    expect(answers.website).toBe("");

    const pending = listPendingInbox(dir);
    expect(pending.map((p) => p.label)).toEqual(
      expect.arrayContaining(["What is your strongest coding language?", "GPA (Undergraduate)", "Website/Portfolio"]),
    );
    expect(pending.find((p) => p.label === "Website/Portfolio")?.key).toBe("website");
    expect(pending.find((p) => p.label === "What is your strongest coding language?")?.required).toBe(true);
    expect(pending.find((p) => p.label === "GPA (Undergraduate)")?.required).toBe(true);
  });

  it("does not recapture answered or dismissed questions", () => {
    const dir = tmpData();
    captureBlockedFields([{ label: "Citizenship Status*", required: true, jobId: "j1" }], dir);
    answerInboxItems({ "Citizenship Status": "U.S. Citizen" }, dir);
    const again = captureBlockedFields([{ label: "Citizenship Status*", required: true, jobId: "j2" }], dir);
    expect(again.addedKeys).not.toContain("Citizenship Status");
    expect(listPendingInbox(dir).map((p) => p.key)).not.toContain("Citizenship Status");

    captureBlockedFields([{ label: "SAT Score*", required: true, jobId: "j1" }], dir);
    dismissInboxItems(["SAT Score"], dir);
    captureBlockedFields([{ label: "SAT Score*", required: true, jobId: "j2" }], dir);
    expect(listPendingInbox(dir).map((p) => p.key)).not.toContain("SAT Score");
  });

  it("is idempotent for the same job", () => {
    const dir = tmpData();
    const field = { label: "GPA (Graduate)", required: false, jobId: "j1", company: "Freeform" };
    captureBlockedFields([field], dir);
    captureBlockedFields([field], dir);
    const pending = listPendingInbox(dir);
    expect(pending.filter((p) => p.key === "GPA (Graduate)")).toHaveLength(1);
    expect(pending[0]?.seen).toBe(1);
  });

  it("stores and merges dropdown choices", () => {
    const dir = tmpData();
    captureBlockedFields(
      [{ label: "How did you hear about us?*", required: true, jobId: "j1", choices: ["Select...", "LinkedIn", "Job Board"] }],
      dir,
    );
    captureBlockedFields(
      [{ label: "How did you hear about us?*", required: true, jobId: "j1", choices: ["LinkedIn", "Referral", "Other"] }],
      dir,
    );
    const item = listPendingInbox(dir).find((p) => p.key === "How did you hear about us?");
    expect(item?.choices).toEqual(["LinkedIn", "Job Board", "Referral", "Other"]);
  });

  it("makes the next lookup fill after the inbox is answered", () => {
    const dir = tmpData();
    const raw = "question_31645096003 What is your strongest coding language?*";
    captureBlockedFields([{ label: raw, required: true, jobId: "j1" }], dir);
    expect(lookupValue(raw, profile, { website: "" }).confidence).toBe("blocked");
    answerInboxItems({ "What is your strongest coding language?": "TypeScript" }, dir);
    const answers = yaml.load(readFileSync(join(dir, "answers.yml"), "utf8")) as Record<string, string>;
    const mapped = lookupValue(raw, profile, answers);
    expect(mapped.value).toBe("TypeScript");
    expect(mapped.confidence).toBe("filled");
  });
});
