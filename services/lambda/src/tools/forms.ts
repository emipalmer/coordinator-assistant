import { z } from 'zod';
import { ObjectId } from 'mongodb';
import {
  applyAnswers, computeImpact, FORM_TEMPLATES, localDate, localToUtc, missingFields, nextQuestions, prefill,
  renderFormPdf, renderImpactPdf, type FormTemplate, type Settings,
} from '@app/core';
import { storeFile } from '../files.js';
import { onboardingPacketFile } from '../artifacts.js';
import type { FormSubmission } from '../db.js';
import { defineTool, type ToolContext } from './registry.js';
import { resolveVolunteer } from './volunteers.js';

const coordinatorForms = Object.values(FORM_TEMPLATES).filter((t) => t.filledBy === 'coordinator');
const FormId = z.enum(coordinatorForms.map((t) => t.id) as [string, ...string[]]);

// The model extracts answers itself, so it needs every form's field keys. Generated from the templates,
// so adding a template is enough to make it fillable over text.
const fieldGuide = coordinatorForms
  .map((t) => `${t.id}: ${t.fields.map((f) => `${f.key} (${f.type}${f.options ? `: ${f.options.join('|')}` : ''})`).join(', ')}`)
  .join('\n');

const Answers = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({});

async function settingsOf(ctx: ToolContext): Promise<Settings> {
  return (await ctx.c.settings.findOne({ _id: 'org' })) ?? { _id: 'org', orgName: 'Our organization', timezone: ctx.timezone, hourlyValueUsd: 36.14 };
}

function progress(t: FormTemplate, sub: FormSubmission & { _id: ObjectId }, errors: unknown[] = [], unknownKeys: string[] = []) {
  const missing = missingFields(t, sub.values);
  return {
    submissionId: String(sub._id),
    form: t.title,
    filled: sub.values,
    stillNeeded: missing.map((f) => f.key),
    askNext: nextQuestions(t, sub.values),
    readyToFinish: missing.length === 0,
    ...(errors.length && { rejectedAnswers: errors }),
    ...(unknownKeys.length && { unknownFields: unknownKeys }),
  };
}

async function activeSubmission(ctx: ToolContext, id?: string) {
  const _id = id ? new ObjectId(id) : (await ctx.c.conversations.findOne({ _id: ctx.coordinator }))?.activeFormSubmissionId;
  if (!_id) return null;
  return (await ctx.c.formSubmissions.findOne({ _id: _id as ObjectId, status: 'in_progress' })) as (FormSubmission & { _id: ObjectId }) | null;
}

export const startForm = defineTool({
  name: 'start_form',
  description: `Start a form the coordinator fills by text. Extract every answer you can from what they already said into \`answers\` (dates YYYY-MM-DD, times HH:mm 24h), then ask only the questions in askNext, briefly. Field keys:\n${fieldGuide}`,
  input: z.object({ templateId: FormId, volunteerName: z.string().optional().describe('The volunteer the form is about, if any'), answers: Answers }),
  async run(ctx, input) {
    const t = FORM_TEMPLATES[input.templateId]!;
    const settings = await settingsOf(ctx);
    let volunteer: Awaited<ReturnType<typeof resolveVolunteer>> | undefined;
    if (input.volunteerName) volunteer = await resolveVolunteer(ctx, input.volunteerName);
    const v = volunteer && 'volunteer' in volunteer ? volunteer.volunteer : undefined;

    const base = prefill(t, { volunteer: v, orgName: settings.orgName, today: localDate(ctx.now, ctx.timezone), coordinatorName: settings.coordinatorName });
    const { values, errors, unknownKeys } = applyAnswers(t, base, input.answers);
    const now = new Date();
    const sub: FormSubmission = { templateId: t.id, coordinator: ctx.coordinator, values, status: 'in_progress', createdAt: now, updatedAt: now, ...(v && { volunteerId: v._id }) };
    const { insertedId } = await ctx.c.formSubmissions.insertOne(sub);
    await ctx.c.conversations.updateOne({ _id: ctx.coordinator }, { $set: { activeFormSubmissionId: insertedId } }, { upsert: true });
    const out = progress(t, { ...sub, _id: insertedId }, errors, unknownKeys);
    // A name the coordinator used that isn't in the roster is fine for a report (could be a client); just note it.
    return { ok: true, content: JSON.stringify({ ...out, ...(volunteer && 'error' in volunteer && { volunteerNote: volunteer.error }) }) };
  },
});

export const updateForm = defineTool({
  name: 'update_form',
  description: 'Add or correct answers on the form in progress. Returns what is still needed; when readyToFinish is true, call finish_form.',
  input: z.object({ answers: Answers, submissionId: z.string().regex(/^[a-f0-9]{24}$/).optional() }),
  async run(ctx, input) {
    const sub = await activeSubmission(ctx, input.submissionId);
    if (!sub) return { ok: false, content: 'No form in progress. Use start_form.' };
    const t = FORM_TEMPLATES[sub.templateId]!;
    const { values, errors, unknownKeys } = applyAnswers(t, sub.values, input.answers);
    await ctx.c.formSubmissions.updateOne({ _id: sub._id }, { $set: { values, updatedAt: new Date() } });
    return { ok: true, content: JSON.stringify(progress(t, { ...sub, values }, errors, unknownKeys)) };
  },
});

export const finishForm = defineTool({
  name: 'finish_form',
  description: 'Generate the PDF for the completed form and send it to the coordinator.',
  input: z.object({ submissionId: z.string().regex(/^[a-f0-9]{24}$/).optional() }),
  async run(ctx, input) {
    const sub = await activeSubmission(ctx, input.submissionId);
    if (!sub) return { ok: false, content: 'No form in progress.' };
    const t = FORM_TEMPLATES[sub.templateId]!;
    const missing = missingFields(t, sub.values);
    if (missing.length) return { ok: false, content: JSON.stringify({ stillNeeded: missing.map((f) => f.key), askNext: nextQuestions(t, sub.values) }) };

    const settings = await settingsOf(ctx);
    const pdf = await renderFormPdf(t, sub.values, { orgName: settings.orgName, generatedLabel: `Generated ${localDate(ctx.now, ctx.timezone)}` });
    const filename = `${t.id}-${sub.values.incidentDate ?? localDate(ctx.now, ctx.timezone)}.pdf`;
    const file = await storeFile('forms', filename, pdf, 'application/pdf');
    ctx.attachments.push(file);
    await ctx.c.formSubmissions.updateOne({ _id: sub._id }, { $set: { status: 'complete', pdfKey: file.key, updatedAt: new Date() } });
    await ctx.c.conversations.updateOne({ _id: ctx.coordinator }, { $unset: { activeFormSubmissionId: '' } });
    return { ok: true, content: JSON.stringify({ sent: filename, note: 'The PDF is attached after your reply.' }) };
  },
});

export const cancelForm = defineTool({
  name: 'cancel_form',
  description: 'Abandon the form in progress.',
  input: z.object({}),
  async run(ctx) {
    const sub = await activeSubmission(ctx);
    if (!sub) return { ok: true, content: 'No form in progress.' };
    await ctx.c.formSubmissions.updateOne({ _id: sub._id }, { $set: { status: 'cancelled', updatedAt: new Date() } });
    await ctx.c.conversations.updateOne({ _id: ctx.coordinator }, { $unset: { activeFormSubmissionId: '' } });
    return { ok: true, content: 'Cancelled.' };
  },
});

export const impactReport = defineTool({
  name: 'impact_report',
  description:
    'Monthly volunteer hours/impact report as a PDF: total hours, estimated dollar value (hours x the configured hourly value), active and new volunteers, shifts, top volunteers. Defaults to last month.',
  input: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe('YYYY-MM') }),
  async run(ctx, input) {
    const settings = await settingsOf(ctx);
    const [y, m] = (input.month ?? lastMonth(localDate(ctx.now, ctx.timezone))).split('-').map(Number) as [number, number];
    const monthStart = localToUtc(`${y}-${String(m).padStart(2, '0')}-01`, ctx.timezone);
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    const monthEnd = localToUtc(`${ny}-${String(nm).padStart(2, '0')}-01`, ctx.timezone);

    const attendance = await ctx.c.attendance.find({ date: { $gte: monthStart, $lt: monthEnd } }).toArray();
    const volunteers = await ctx.c.volunteers.find({}, { projection: { name: 1, createdAt: 1 } }).toArray();
    const shiftsHeld = await ctx.c.shifts.countDocuments({ start: { $gte: monthStart, $lt: monthEnd }, status: 'scheduled' });
    const report = computeImpact({
      attendance: attendance.map((a) => ({ volunteerId: String(a.volunteerId), date: a.date, hours: a.hours, activity: a.activity })),
      volunteers: volunteers.map((v) => ({ id: String(v._id), name: v.name, createdAt: v.createdAt })),
      shiftsHeld,
      hourlyValueUsd: settings.hourlyValueUsd,
      monthStart,
      monthEnd,
    });
    const monthLabel = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const pdf = await renderImpactPdf(report, { orgName: settings.orgName, generatedLabel: `Generated ${localDate(ctx.now, ctx.timezone)}`, monthLabel });
    ctx.attachments.push(await storeFile('reports', `impact-${y}-${String(m).padStart(2, '0')}.pdf`, pdf, 'application/pdf'));
    return { ok: true, content: JSON.stringify({ month: monthLabel, ...report, note: 'PDF attached after your reply. Mention the hourly value used and that it can be changed.' }) };
  },
});

export const onboardingPacketTool = defineTool({
  name: 'onboarding_packet',
  description: 'Generate a pre-filled onboarding packet PDF (application, emergency contact, waiver, code of conduct, guardian consent if a minor) for the coordinator to forward to a volunteer.',
  input: z.object({ name: z.string() }),
  async run(ctx, input) {
    const found = await resolveVolunteer(ctx, input.name);
    if ('error' in found) return { ok: false, content: found.error };
    const v = found.volunteer;
    const f = await onboardingPacketFile(ctx, v);
    ctx.attachments.push(await storeFile('packets', f.filename, f.bytes, f.contentType));
    return { ok: true, content: JSON.stringify({ volunteer: v.name, includesGuardianConsent: v.isMinor, note: 'PDF attached after your reply. Offer a short [[draft]] message to send with it.' }) };
  },
});

export const updateSettings = defineTool({
  name: 'update_settings',
  description: 'Change organization settings: the dollar value per volunteer hour used in impact reports, the coordinator name used on forms, or the organization name.',
  input: z.object({
    hourlyValueUsd: z.number().positive().max(500).optional(),
    coordinatorName: z.string().min(1).optional(),
    orgName: z.string().min(1).optional(),
  }),
  async run(ctx, input) {
    const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    if (!Object.keys(set).length) return { ok: false, content: 'Nothing to change.' };
    await ctx.c.settings.updateOne({ _id: 'org' }, { $set: set }, { upsert: true });
    return { ok: true, content: JSON.stringify({ updated: set }) };
  },
});

function lastMonth(today: string) {
  const [y, m] = today.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
