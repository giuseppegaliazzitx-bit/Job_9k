import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyOptionLearning, rememberSnappedValue } from "./learner.js";

describe("option learner", () => {
  it("remembers a dropdown wording correction and applies it next time", () => {
    const dir = mkdtempSync(join(tmpdir(), "job9k-learn-"));
    rememberSnappedValue("How did you hear about us?*", "Job Boards", "Indeed / Job Boards", "greenhouse", dir);
    expect(applyOptionLearning("question_1 How did you hear about us?", "Job Boards", "greenhouse", dir)).toBe(
      "Indeed / Job Boards",
    );
    expect(applyOptionLearning("How did you hear about us?", "LinkedIn", "greenhouse", dir)).toBe("LinkedIn");
  });
});
