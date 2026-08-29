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

export async function scanFormFields(page: Page): Promise<ScannedField[]> {
  const raw = await page.evaluate(() => {
    const results: Array<{
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
    }> = [];
    const seen = new Set<string>();

    function getLabel(el: Element): string {
      const htmlEl = el as HTMLElement;
      if (htmlEl.id) {
        const label = document.querySelector(`label[for="${CSS.escape(htmlEl.id)}"]`);
        if (label?.textContent) return label.textContent.trim();
      }
      const parentLabel = el.closest("label");
      if (parentLabel?.textContent) return parentLabel.textContent.trim();
      if (htmlEl.getAttribute("aria-label")) return htmlEl.getAttribute("aria-label")!.trim();
      const labelledBy = htmlEl.getAttribute("aria-labelledby");
      if (labelledBy) {
        const ref = document.getElementById(labelledBy.split(/\s+/)[0] ?? "");
        if (ref?.textContent) return ref.textContent.trim();
      }
      if ((htmlEl as HTMLInputElement).placeholder) return (htmlEl as HTMLInputElement).placeholder.trim();
      return (htmlEl.getAttribute("name") || htmlEl.id || "").trim();
    }

    function requiredOf(el: HTMLElement): boolean {
      const input = el as HTMLInputElement;
      return Boolean(
        input.required ||
          el.getAttribute("aria-required") === "true" ||
          /\*/.test(getLabel(el)),
      );
    }

    document.querySelectorAll("input, textarea, select").forEach((node) => {
      const el = node as HTMLInputElement;
      const type = (el.type || el.tagName.toLowerCase()).toLowerCase();
      if (["hidden", "submit", "button", "image", "reset"].includes(type)) return;
      const key = el.id || el.name || `${type}-${results.length}`;
      if (seen.has(key)) return;
      seen.add(key);
      let selector = "";
      if (el.id) selector = `#${CSS.escape(el.id)}`;
      else if (el.name) selector = `${el.tagName.toLowerCase()}[name="${el.name.replace(/"/g, '\\"')}"]`;
      const options: string[] = [];
      if (el instanceof HTMLSelectElement) {
        for (const o of el.options) {
          const t = (o.textContent || o.label || "").trim();
          if (t) options.push(t);
        }
      }
      if (type === "radio" && el.name) {
        document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`).forEach((r) => {
          const re = r as HTMLInputElement;
          const lab = re.id ? document.querySelector(`label[for="${CSS.escape(re.id)}"]`) : null;
          options.push((lab?.textContent || re.value || "").trim());
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
        className: `${el.className || ""} ${wrap ? "iti" : ""}`,
        required: requiredOf(el),
        selector,
        options: options.filter(Boolean),
        autocomplete: (el.getAttribute("autocomplete") || "").toLowerCase(),
      });
    });

    document.querySelectorAll('[role="combobox"], [aria-haspopup="listbox"]').forEach((el) => {
      const html = el as HTMLElement;
      const key = html.id || html.getAttribute("name") || `combo-${results.length}`;
      if (seen.has(key)) return;
      seen.add(key);
      results.push({
        id: html.id || key,
        name: html.getAttribute("name") || "",
        label: getLabel(html),
        inputType: "text",
        tag: html.tagName.toLowerCase(),
        role: "combobox",
        className: String(html.className || ""),
        required: requiredOf(html),
        selector: html.id ? `#${CSS.escape(html.id)}` : '[role="combobox"]',
        options: [],
        autocomplete: (html.getAttribute("autocomplete") || "").toLowerCase(),
      });
    });

    document.querySelectorAll("label").forEach((label) => {
      const container =
        label.closest('[class*="field"], [class*="question"], [class*="Field"]') || label.parentElement;
      if (!container) return;
      const buttons = [...container.querySelectorAll("button")].map((b) => b.textContent?.trim() || "");
      if (buttons.includes("Yes") && buttons.includes("No")) {
        const key = `yesno-${label.textContent?.trim().slice(0, 40)}`;
        if (seen.has(key)) return;
        seen.add(key);
        results.push({
          id: label.htmlFor || key,
          name: "",
          label: (label.textContent || "").trim(),
          inputType: "yes-no-button",
          tag: "button",
          role: "",
          className: "",
          required: /\*/.test(label.textContent || ""),
          selector: "",
          options: ["Yes", "No"],
          autocomplete: "",
        });
      }
    });

    return results;
  });

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
