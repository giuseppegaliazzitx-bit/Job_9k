import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectAtsFromHtml, detectAtsFromUrl, parsePastedUrls } from "./detect.js";
import { isKnockoutLabel, lookupValue } from "./mapping.js";
import type { AnswerBank, Profile } from "./types.js";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/fixtures");

describe("detectAtsFromUrl", () => {
  it("detects Greenhouse job boards", () => {
    const d = detectAtsFromUrl("https://job-boards.greenhouse.io/stripe/jobs/4793486007");
    expect(d.ats).toBe("greenhouse");
    expect(d.confidence).toBeGreaterThan(0.9);
    expect(d.companyHint.toLowerCase()).toContain("stripe");
  });

  it("detects classic boards.greenhouse.io", () => {
    expect(detectAtsFromUrl("https://boards.greenhouse.io/company/jobs/123").ats).toBe("greenhouse");
  });

  it("detects Lever", () => {
    const d = detectAtsFromUrl("https://jobs.lever.co/netflix/abc-123");
    expect(d.ats).toBe("lever");
    expect(d.companyHint.toLowerCase()).toContain("netflix");
  });

  it("detects Ashby", () => {
    expect(detectAtsFromUrl("https://jobs.ashbyhq.com/openai/uuid").ats).toBe("ashby");
  });

  it("detects Workday", () => {
    const d = detectAtsFromUrl("https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite");
    expect(d.ats).toBe("workday");
    expect(d.companyHint.toLowerCase()).toContain("nvidia");
  });

  it("detects Gem, iCIMS, SmartRecruiters", () => {
    expect(detectAtsFromUrl("https://jobs.gem.com/acme/job/1").ats).toBe("gem");
    expect(detectAtsFromUrl("https://acme.icims.com/jobs/123/job").ats).toBe("icims");
    expect(detectAtsFromUrl("https://jobs.smartrecruiters.com/Acme/123").ats).toBe("smartrecruiters");
  });

  it("falls back to custom for unknown career pages", () => {
    const d = detectAtsFromUrl("https://careers.example.com/jobs/backend");
    expect(d.ats).toBe("custom");
    expect(d.confidence).toBe(0);
  });
});

describe("detectAtsFromHtml", () => {
  it("fingerprints fixture pages", () => {
    expect(detectAtsFromHtml(readFileSync(resolve(fixtures, "greenhouse.html"), "utf8"))?.ats).toBe("greenhouse");
    expect(detectAtsFromHtml(readFileSync(resolve(fixtures, "lever.html"), "utf8"))?.ats).toBe("lever");
    expect(detectAtsFromHtml(readFileSync(resolve(fixtures, "ashby.html"), "utf8"))?.ats).toBe("ashby");
    expect(detectAtsFromHtml(readFileSync(resolve(fixtures, "workday.html"), "utf8"))?.ats).toBe("workday");
  });
});

describe("parsePastedUrls", () => {
  it("splits newlines, skips comments, dedupes", () => {
    const urls = parsePastedUrls(`
# comment
https://jobs.lever.co/a/1
jobs.lever.co/a/1
https://job-boards.greenhouse.io/b/jobs/2
`);
    expect(urls).toHaveLength(2);
  });
});

describe("knockout mapping", () => {
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
      country: "US",
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
  const answers: AnswerBank = {};

  it("fills identity without guessing", () => {
    expect(lookupValue("Email", profile, answers).value).toBe("j@example.com");
    expect(lookupValue("First Name", profile, answers).confidence).toBe("filled");
  });

  it("blocks salary when not in profile or answer bank", () => {
    expect(isKnockoutLabel("Salary expectation")).toBe(true);
    const mapped = lookupValue("Salary expectation", profile, answers);
    expect(mapped.confidence).toBe("blocked");
    expect(mapped.value).toBe("");
  });

  it("fills sponsorship from explicit profile flag", () => {
    const mapped = lookupValue("Will you require visa sponsorship?", profile, answers);
    expect(mapped.value).toBe("No");
    expect(mapped.confidence).toBe("filled");
  });
});
