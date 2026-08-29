import { applyOptionLearning, lookupValue, pickClosestChoice, rememberSnappedValue } from "@job9k/core";
import {
  blockedOutcome,
  fillSelectOrDropdown,
  handlePhoneCountry,
  handleTypeahead,
  handleYesNoButton,
  typeFill,
  uploadFirstMatching,
  verifyDropdownFilled,
  waitIfPaused,
} from "./fields.js";
import { scanFormFields, type ScannedField } from "./scan.js";
import type { AdapterContext, FieldOutcome } from "./types.js";

export interface FillScanOptions {
  skipCheckbox?: boolean;
  skipRadio?: boolean;
  ats?: string;
}

function looksFilled(value: string): boolean {
  const v = value.trim();
  return Boolean(v) && !/^(select\.?\.?\.?)$/i.test(v);
}

async function locate(ctx: AdapterContext, field: ScannedField) {
  const page = ctx.page;
  if (field.selector) {
    const loc = page.locator(field.selector).first();
    if ((await loc.count().catch(() => 0)) > 0) return loc;
  }
  if (field.id) {
    const loc = page.locator(`#${field.id.replace(/([^\w-])/g, "\\$1")}`).first();
    if ((await loc.count().catch(() => 0)) > 0) return loc;
  }
  if (field.name) {
    const loc = page.locator(`[name="${field.name.replace(/"/g, '\\"')}"]`).first();
    if ((await loc.count().catch(() => 0)) > 0) return loc;
  }
  if (field.label) {
    const loc = page.getByLabel(field.label.replace(/\*+/g, "").trim(), { exact: false });
    if ((await loc.count().catch(() => 0)) > 0) return loc.first();
  }
  return null;
}

async function fieldEmpty(ctx: AdapterContext, field: ScannedField): Promise<boolean> {
  if (field.type === "yes-no-button" || field.type === "checkbox" || field.type === "file") return false;
  const loc = await locate(ctx, field);
  if (!loc) return false;
  if (field.type === "select" || field.type === "dropdown" || field.type === "phone-country") {
    return !(await verifyDropdownFilled(loc));
  }
  const val = await loc.inputValue().catch(() => "");
  return !looksFilled(val);
}

export async function fillScannedFields(
  ctx: AdapterContext,
  fields: ScannedField[],
  opts: FillScanOptions = {},
): Promise<FieldOutcome[]> {
  const outcomes: FieldOutcome[] = [];
  const seen = new Set<string>();

  for (const field of fields) {
    const key = (field.label || field.id || field.name).toLowerCase();
    if (!key || seen.has(key)) continue;
    if (/recaptcha|honeypot|search/i.test(key)) continue;
    if (opts.skipCheckbox && field.type === "checkbox") continue;
    if (opts.skipRadio && field.type === "radio") continue;
    seen.add(key);
    await waitIfPaused(ctx);

    if (field.type !== "yes-no-button" && field.type !== "file" && field.type !== "checkbox") {
      const loc0 = await locate(ctx, field);
      if (loc0) {
        const existing = await loc0.inputValue().catch(() => "");
        if (looksFilled(existing)) continue;
      }
    }

    if (field.type === "file") {
      const isCover = /cover/i.test(key);
      const path = isCover ? ctx.coverLetterPath : ctx.resumePath;
      const uploaded = path ? await uploadFirstMatching(ctx.page, [field.selector || "input[type='file']", "input[type='file']"], path) : false;
      const o: FieldOutcome = {
        label: field.label || (isCover ? "Cover letter" : "Resume"),
        value: path,
        confidence: uploaded ? "filled" : "blocked",
        required: field.required || !isCover,
      };
      outcomes.push(o);
      ctx.onField(o);
      continue;
    }

    if (field.type === "checkbox") {
      continue;
    }

    const mapped = lookupValue(field.label || field.name || field.id, ctx.profile, ctx.answers);
    const learned = applyOptionLearning(field.label || field.id, mapped.value, opts.ats);
    const snapped = pickClosestChoice(learned, field.options);
    const value = rememberSnappedValue(field.label || field.id, mapped.value, snapped, opts.ats);
    const loc = field.type === "yes-no-button" ? null : await locate(ctx, field);

    if (!value) {
      const o = loc
        ? await blockedOutcome(ctx.page, loc, field.label || field.id, field.required || mapped.knockout, field.options)
        : { label: field.label || field.id, value: "", confidence: "blocked" as const, required: field.required || mapped.knockout, choices: field.options };
      outcomes.push(o);
      ctx.onField(o);
      continue;
    }

    let ok = false;
    if (field.type === "yes-no-button") {
      ok = await handleYesNoButton(ctx.page, field.label, value);
    } else if (!loc) {
      ok = false;
    } else if (field.type === "phone-country") {
      ok = await handlePhoneCountry(ctx.page, loc, value);
    } else if (field.type === "typeahead") {
      ok = await handleTypeahead(ctx.page, loc, value);
    } else if (field.type === "select" || field.type === "dropdown") {
      ok = await fillSelectOrDropdown(ctx.page, loc, value);
    } else if (field.type === "radio") {
      const radio = ctx.page.locator(`input[type="radio"][name="${field.name}"][value="${value}"]`).first();
      if ((await radio.count()) > 0) {
        await radio.check({ force: true }).catch(() => radio.click());
        ok = true;
      } else {
        ok = await handleYesNoButton(ctx.page, field.label, value);
      }
    } else {
      try {
        await typeFill(loc, value, ctx.typingDelayMs);
        ok = looksFilled(await loc.inputValue().catch(() => value));
      } catch {
        ok = await fillSelectOrDropdown(ctx.page, loc, value);
      }
    }

    const o: FieldOutcome = {
      label: field.label || field.id,
      value,
      confidence: ok ? mapped.confidence : "blocked",
      required: field.required || mapped.knockout,
      choices: field.options,
    };
    outcomes.push(o);
    ctx.onField(o);
  }

  return outcomes;
}

export async function verifyAndRetry(
  ctx: AdapterContext,
  fields: ScannedField[],
  outcomes: FieldOutcome[],
  opts: FillScanOptions = {},
): Promise<FieldOutcome[]> {
  const byLabel = new Map(outcomes.map((o) => [o.label.toLowerCase(), o]));
  const retry: ScannedField[] = [];
  for (const field of fields) {
    const outcome = byLabel.get((field.label || field.id).toLowerCase());
    if (!outcome || outcome.confidence !== "filled") continue;
    if (await fieldEmpty(ctx, field)) retry.push(field);
  }
  if (!retry.length) return outcomes;
  ctx.log(`Verification: retrying ${retry.length} empty field(s)`);
  const again = await fillScannedFields(ctx, retry, opts);
  for (const o of again) {
    const idx = outcomes.findIndex((x) => x.label.toLowerCase() === o.label.toLowerCase());
    if (idx >= 0) outcomes[idx] = o;
    else outcomes.push(o);
  }
  return outcomes;
}

export async function scanPlanFill(ctx: AdapterContext, opts: FillScanOptions = {}): Promise<FieldOutcome[]> {
  try {
    const fields = await scanFormFields(ctx.page);
    ctx.log(`Scan: ${fields.length} fields`);
    const outcomes = await fillScannedFields(ctx, fields, opts);
    return verifyAndRetry(ctx, fields, outcomes, opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log(`Scan/fill failed: ${message}`, "error");
    return [];
  }
}
