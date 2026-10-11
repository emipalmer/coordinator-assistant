import { normalizePhone } from '../phone.js';
import type { FieldDef, FieldValue, FormTemplate, FormValues, Prefill } from './types.js';

export function isRequired(field: FieldDef, values: FormValues): boolean {
  if (field.requiredWhen) {
    const v = values[field.requiredWhen.field];
    return v !== undefined && normalizeForCompare(v) === normalizeForCompare(field.requiredWhen.equals);
  }
  return Boolean(field.required);
}

const isEmpty = (v: FieldValue | undefined) => v === undefined || (typeof v === 'string' && v.trim() === '');

/** Required fields still empty, in form order. */
export function missingFields(t: FormTemplate, values: FormValues): FieldDef[] {
  return t.fields.filter((f) => isRequired(f, values) && isEmpty(values[f.key]));
}

/** The next 1-2 questions to text. Two at a time keeps the thread short without overwhelming. */
export function nextQuestions(t: FormTemplate, values: FormValues, max = 2): string[] {
  return missingFields(t, values).slice(0, max).map((f) => f.ask);
}

type Coerced = { ok: true; value: FieldValue } | { ok: false; error: string };

/** Validate and normalize one answer for a field's type. */
export function coerce(field: FieldDef, raw: unknown): Coerced {
  const s = typeof raw === 'string' ? raw.trim() : raw;
  switch (field.type) {
    case 'text':
    case 'longtext':
      return typeof s === 'string' && s ? { ok: true, value: s } : { ok: false, error: 'expected text' };
    case 'date':
      return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
        ? { ok: true, value: s }
        : { ok: false, error: 'expected YYYY-MM-DD' };
    case 'time': {
      const m = typeof s === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(s) : null;
      return m && +m[1]! < 24 && +m[2]! < 60 ? { ok: true, value: `${m[1]!.padStart(2, '0')}:${m[2]}` } : { ok: false, error: 'expected HH:mm (24h)' };
    }
    case 'number': {
      const n = typeof s === 'number' ? s : Number(s);
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: 'expected a number' };
    }
    case 'boolean': {
      if (typeof s === 'boolean') return { ok: true, value: s };
      const t = String(s).toLowerCase();
      if (['yes', 'y', 'true'].includes(t)) return { ok: true, value: true };
      if (['no', 'n', 'false'].includes(t)) return { ok: true, value: false };
      return { ok: false, error: 'expected yes or no' };
    }
    case 'enum': {
      const hit = field.options?.find((o) => o.toLowerCase() === String(s).toLowerCase());
      return hit ? { ok: true, value: hit } : { ok: false, error: `expected one of: ${field.options?.join(', ')}` };
    }
    case 'phone': {
      const p = typeof s === 'string' ? normalizePhone(s) : null;
      return p ? { ok: true, value: p } : { ok: false, error: 'expected a phone number' };
    }
  }
}

export interface ApplyResult {
  values: FormValues;
  errors: Array<{ key: string; error: string }>;
  unknownKeys: string[];
}

/** Merge answers into existing values; invalid answers are reported, not stored. */
export function applyAnswers(t: FormTemplate, values: FormValues, answers: Record<string, unknown>): ApplyResult {
  const next = { ...values };
  const errors: ApplyResult['errors'] = [];
  const unknownKeys: string[] = [];
  for (const [key, raw] of Object.entries(answers)) {
    const field = t.fields.find((f) => f.key === key);
    if (!field) {
      unknownKeys.push(key);
      continue;
    }
    if (raw === null || raw === undefined || raw === '') continue;
    const c = coerce(field, raw);
    if (c.ok) next[key] = c.value;
    else errors.push({ key, error: c.error });
  }
  return { values: next, errors, unknownKeys };
}

export interface PrefillSource {
  volunteer?: { name: string; phone?: string; email?: string; isMinor: boolean };
  orgName: string;
  today: string; // YYYY-MM-DD local
  coordinatorName?: string;
}

/** Fill whatever the database already knows, so the coordinator is only asked for the rest. */
export function prefill(t: FormTemplate, src: PrefillSource): FormValues {
  const lookup: Record<Prefill, FieldValue | undefined> = {
    'volunteer.name': src.volunteer?.name,
    'volunteer.phone': src.volunteer?.phone,
    'volunteer.email': src.volunteer?.email,
    'volunteer.isMinor': src.volunteer?.isMinor,
    'org.name': src.orgName,
    today: src.today,
    'coordinator.name': src.coordinatorName,
  };
  const out: FormValues = {};
  for (const f of t.fields) {
    const v = f.prefill ? lookup[f.prefill] : undefined;
    if (v !== undefined && v !== '') out[f.key] = v;
  }
  return out;
}

/** Display string for a value on the PDF. */
export function displayValue(field: FieldDef, v: FieldValue | undefined): string {
  if (v === undefined || v === '') return '';
  if (field.type === 'boolean') return v ? 'Yes' : 'No';
  if (field.type === 'date' && typeof v === 'string') {
    return new Date(`${v}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  if (field.type === 'enum' && typeof v === 'string') return v.charAt(0).toUpperCase() + v.slice(1);
  return String(v);
}

const normalizeForCompare = (v: FieldValue) => (typeof v === 'string' ? v.toLowerCase() : v);
