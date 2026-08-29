import type { Page } from "playwright";
import { mergeChoices } from "@job9k/core";

export type ScannedFieldType =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "textarea"
  | "select"
  | "dropdown"
  | "typeahead"
  | "phone-country"
  | "checkbox"
  | "radio"
  | "file"
  | "yes-no-button";

export interface ScannedField {
  id: string;
  name: string;
  label: string;
  type: ScannedFieldType;
  required: boolean;
  selector: string;
  options: string[];
}

const DROPDOWN_LABEL = /country|gender|veteran|disability|ethnicity|race|hispanic|hear about|citizenship|degree|discipline/i;
const TYPEAHEAD_LABEL = /location|city|company|school|university|employer/i;

export function classifyScannedField(raw: {
  id: string;
  name: string;
  label: string;
  inputType: string;
  tag: string;
  role: string;
  className: string;
  required: boolean;
  selector: string;
  options: string[];
  autocomplete?: string;
}): ScannedField {
  const typeIn = (raw.inputType || raw.tag || "text").toLowerCase();
  const blob = `${raw.label} ${raw.name} ${raw.id} ${raw.className}`;
  let type: ScannedFieldType = "text";
  if (typeIn === "file") type = "file";
  else if (typeIn === "checkbox") type = "checkbox";
  else if (typeIn === "radio") type = "radio";
  else if (typeIn === "textarea") type = "textarea";
  else if (typeIn === "select" || typeIn === "select-one") type = "select";
  else if (typeIn === "email") type = "email";
  else if (typeIn === "tel") type = "tel";
  else if (typeIn === "url") type = "url";
  else if ((/iti/.test(raw.className) && typeIn !== "tel") || /phone.?country|country.?code|dial.?code/i.test(blob))
    type = "phone-country";
  else if (raw.role === "combobox" || /listbox|menu/.test(raw.role)) {
    type = TYPEAHEAD_LABEL.test(raw.label) || raw.autocomplete === "address" ? "typeahead" : "dropdown";
  } else if (DROPDOWN_LABEL.test(raw.label) || DROPDOWN_LABEL.test(raw.name)) type = "dropdown";
  else if (TYPEAHEAD_LABEL.test(raw.label) && /auto/.test(raw.autocomplete || "")) type = "typeahead";

  return {
    id: raw.id,
    name: raw.name,
    label: raw.label,
    type,
    required: raw.required,
    selector: raw.selector,
    options: mergeChoices([], raw.options),
  };
}

const SCAN_IN_PAGE = `(() => {
  const results = [];
  const seen = new Set();
  const getLabel = (el) => {
    if (el.id) {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (label && label.textContent) return label.textContent.trim();
    }
    const parentLabel = el.closest("label");
    if (parentLabel && parentLabel.textContent) return parentLabel.textContent.trim();
    if (el.getAttribute("aria-label")) return el.getAttribute("aria-label").trim();
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const ref = document.getElementById(labelledBy.split(/\\s+/)[0] || "");
      if (ref && ref.textContent) return ref.textContent.trim();
    }
    if (el.placeholder) return String(el.placeholder).trim();
    return String(el.getAttribute("name") || el.id || "").trim();
  };
  const requiredOf = (el) => !!(el.required || el.getAttribute("aria-required") === "true" || /\\*/.test(getLabel(el)));
  document.querySelectorAll("input, textarea, select").forEach((el) => {
    const type = (el.type || el.tagName.toLowerCase()).toLowerCase();
    if (["hidden", "submit", "button", "image", "reset"].includes(type)) return;
    const key = el.id || el.name || type + "-" + results.length;
    if (seen.has(key)) return;
    seen.add(key);
    let selector = "";
    if (el.id) selector = "#" + CSS.escape(el.id);
    else if (el.name) selector = el.tagName.toLowerCase() + '[name="' + String(el.name).replace(/"/g, '\\\\"') + '"]';
    const options = [];
    if (el.tagName.toLowerCase() === "select") {
      Array.from(el.options).forEach((o) => {
        const t = (o.textContent || o.label || "").trim();
        if (t) options.push(t);
      });
    }
    if (type === "radio" && el.name) {
      document.querySelectorAll('input[type="radio"][name="' + CSS.escape(el.name) + '"]').forEach((r) => {
        const lab = r.id ? document.querySelector('label[for="' + CSS.escape(r.id) + '"]') : null;
        options.push(((lab && lab.textContent) || r.value || "").trim());
      });
    }
    const wrap = el.closest(".iti, [class*='iti']");
    results.push({
      id: el.id || key,
      name: el.name || "",
      label: getLabel(el),
      inputType: wrap && type === "tel" ? "tel" : type,
      tag: el.tagName.toLowerCase(),
      role: (el.getAttribute("role") || "").toLowerCase(),
      className: String(el.className || "") + (wrap ? " iti" : ""),
      required: requiredOf(el),
      selector: selector,
      options: options.filter(Boolean),
      autocomplete: (el.getAttribute("autocomplete") || "").toLowerCase(),
    });
  });
  document.querySelectorAll('[role="combobox"], [aria-haspopup="listbox"]').forEach((el) => {
    const key = el.id || el.getAttribute("name") || "combo-" + results.length;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({
      id: el.id || key,
      name: el.getAttribute("name") || "",
      label: getLabel(el),
      inputType: "text",
      tag: el.tagName.toLowerCase(),
      role: "combobox",
      className: String(el.className || ""),
      required: requiredOf(el),
      selector: el.id ? "#" + CSS.escape(el.id) : '[role="combobox"]',
      options: [],
      autocomplete: (el.getAttribute("autocomplete") || "").toLowerCase(),
    });
  });
  document.querySelectorAll("label").forEach((label) => {
    const container = label.closest('[class*="field"], [class*="question"], [class*="Field"]') || label.parentElement;
    if (!container) return;
    const buttons = Array.from(container.querySelectorAll("button")).map((b) => (b.textContent || "").trim());
    if (buttons.indexOf("Yes") >= 0 && buttons.indexOf("No") >= 0) {
      const key = "yesno-" + String(label.textContent || "").trim().slice(0, 40);
      if (seen.has(key)) return;
      seen.add(key);
      results.push({
        id: label.htmlFor || key,
        name: "",
        label: String(label.textContent || "").trim(),
        inputType: "yes-no-button",
        tag: "button",
        role: "",
        className: "",
        required: /\\*/.test(label.textContent || ""),
        selector: "",
        options: ["Yes", "No"],
        autocomplete: "",
      });
    }
  });
  return results;
})()`;

export async function scanFormFields(page: Page): Promise<ScannedField[]> {
  const raw = (await page.evaluate(SCAN_IN_PAGE)) as Array<{
    id: string;
    name: string;
    label: string;
    inputType: string;
    tag: string;
    role: string;
    className: string;
    required: boolean;
    selector: string;
    options: string[];
    autocomplete: string;
  }>;

  return raw
    .map((r) =>
      classifyScannedField({
        ...r,
        inputType: r.inputType === "yes-no-button" ? "text" : r.inputType,
      }),
    )
    .map((field, i) => {
      const source = raw[i];
      if (source?.inputType === "yes-no-button") {
        return { ...field, type: "yes-no-button" as const, options: ["Yes", "No"] };
      }
      return field;
    });
}
