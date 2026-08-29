import { describe, expect, it } from "vitest";
import { classifyScannedField } from "./scan.js";

function raw(partial: Partial<Parameters<typeof classifyScannedField>[0]>) {
  return classifyScannedField({
    id: "",
    name: "",
    label: "",
    inputType: "text",
    tag: "input",
    role: "",
    className: "",
    required: false,
    selector: "",
    options: [],
    ...partial,
  });
}

describe("classifyScannedField", () => {
  it("keeps native types", () => {
    expect(raw({ inputType: "email" }).type).toBe("email");
    expect(raw({ inputType: "select-one" }).type).toBe("select");
    expect(raw({ inputType: "file" }).type).toBe("file");
  });

  it("treats country/gender comboboxes as dropdowns and location as typeahead", () => {
    expect(raw({ label: "Country", role: "combobox" }).type).toBe("dropdown");
    expect(raw({ label: "Location (City)", role: "combobox" }).type).toBe("typeahead");
    expect(raw({ label: "Gender", inputType: "text" }).type).toBe("dropdown");
  });

  it("detects intl-tel country pickers", () => {
    expect(raw({ className: "iti__flag-container", label: "Country code" }).type).toBe("phone-country");
  });
});
