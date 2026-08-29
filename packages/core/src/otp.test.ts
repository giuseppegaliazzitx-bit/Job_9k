import { describe, expect, it } from "vitest";
import { extractOTP, looksLikeOtpPrompt } from "./otp.js";

describe("extractOTP", () => {
  it("pulls a 6-digit code from common email wording", () => {
    expect(extractOTP("Your verification code is: 482913")).toBe("482913");
    expect(extractOTP("Enter this code 91AB3C to continue")).toBe("91AB3C");
    expect(extractOTP("OTP: 102938")).toBe("102938");
    expect(extractOTP("Hello\n\n847291\n\nThis code expires in 10 minutes.")).toBe("847291");
  });

  it("returns null when no code is present", () => {
    expect(extractOTP("Thanks for applying to Acme.")).toBeNull();
  });
});

describe("looksLikeOtpPrompt", () => {
  it("detects verification walls", () => {
    expect(looksLikeOtpPrompt("Enter the 6-character code we sent you")).toBe(true);
    expect(looksLikeOtpPrompt("Check your email to verify this device")).toBe(true);
    expect(looksLikeOtpPrompt("First Name")).toBe(false);
  });
});
