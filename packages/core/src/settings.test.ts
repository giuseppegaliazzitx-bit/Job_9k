import { describe, expect, it } from "vitest";
import { mergeSettings, normalizeSettings, redactSettings, SECRET_PLACEHOLDER } from "./profile.js";

describe("settings secrets", () => {
  it("keeps stored passwords when the client sends a placeholder", () => {
    const current = normalizeSettings({
      otp: { enabled: true, email: "a@gmail.com", app_password: "real-app-pw" },
      accounts: { workday: { email: "a@gmail.com", password: "wd-secret" } },
    });
    const merged = mergeSettings(current, {
      otp: { ...current.otp, app_password: SECRET_PLACEHOLDER },
      accounts: { workday: { email: "a@gmail.com", password: "" } },
    });
    expect(merged.otp.app_password).toBe("real-app-pw");
    expect(merged.accounts.workday.password).toBe("wd-secret");
    expect(redactSettings(merged).otp.app_password).toBe(SECRET_PLACEHOLDER);
  });
});
