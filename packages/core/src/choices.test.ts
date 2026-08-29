import { describe, expect, it } from "vitest";
import { mergeChoices, normalizeChoice } from "./choices.js";

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
