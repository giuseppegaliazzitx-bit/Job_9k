import { describe, expect, it } from "vitest";
import { mergeChoices, normalizeChoice, pickClosestChoice } from "./choices.js";

describe("normalizeChoice", () => {
  it("drops placeholders and empties", () => {
    expect(normalizeChoice("Select...")).toBeNull();
    expect(normalizeChoice("Please select")).toBeNull();
    expect(normalizeChoice("  ")).toBeNull();
    expect(normalizeChoice("LinkedIn")).toBe("LinkedIn");
    expect(normalizeChoice("  U.S. Citizen  ")).toBe("U.S. Citizen");
  });
});

describe("mergeChoices", () => {
  it("unions, de-dupes case-insensitively, and drops placeholders", () => {
    expect(mergeChoices(["Select...", "LinkedIn", "Job Board"], ["linkedin", "Referral"])).toEqual([
      "LinkedIn",
      "Job Board",
      "Referral",
    ]);
  });
});

describe("pickClosestChoice", () => {
  it("snaps profile values to the form's option text", () => {
    expect(pickClosestChoice("United States", ["Canada", "United States of America", "Mexico"])).toBe(
      "United States of America",
    );
    expect(pickClosestChoice("Job Boards", ["LinkedIn", "Indeed / Job Boards", "Other"])).toBe("Indeed / Job Boards");
    expect(pickClosestChoice("LinkedIn", ["LinkedIn", "Other"])).toBe("LinkedIn");
  });
});
