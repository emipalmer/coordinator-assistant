import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { Availability, Birthday, initialCompliance, matchName, missingCompliance, VolunteerStatus, type Volunteer } from '@app/core';
import { embed } from '../embeddings.js';
import { defineTool, type ToolContext } from './registry.js';

export const VECTOR_INDEX = 'volunteer_notes_vector';

const VolunteerFields = z.object({
  phone: z.string().optional(),
  email: z.string().email().optional(),
  birthday: Birthday.optional().describe('Month and day only; never ask for birth year.'),
  isMinor: z.boolean().optional().describe('True if under 18 (requires guardian consent).'),
  availability: z.array(Availability).optional(),
  skills: z.array(z.string()).optional(),
  interests: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

/** Text we embed for matching: everything that describes what someone is good at or wants to do. */
export function profileText(v: Pick<Volunteer, 'name' | 'skills' | 'interests' | 'notes' | 'availability'>): string {
  const avail = v.availability.map((a) => `${a.day} ${a.part}`).join(', ');
  return [`Skills: ${v.skills.join(', ')}`, `Interests: ${v.interests.join(', ')}`, `Available: ${avail}`, `Notes: ${v.notes}`].join('\n');
}

/** Resolve a typed name to exactly one volunteer, or return a message the model can relay to the coordinator. */
export async function resolveVolunteer(ctx: ToolContext, name: string): Promise<{ volunteer: Volunteer & { _id: ObjectId } } | { error: string }> {
  const all = (await ctx.c.volunteers.find({}, { projection: { notesEmbedding: 0 } }).toArray()) as Array<Volunteer & { _id: ObjectId }>;
  const m = matchName(name, all);
  if (m.kind === 'one') return { volunteer: m.item };
  if (m.kind === 'many') return { error: `"${name}" matches several volunteers: ${m.items.map((v) => v.name).join(', ')}. Ask which one.` };
  return { error: `No volunteer named "${name}".` };
}

function summarize(v: Volunteer & { _id?: unknown }) {
  return {
    id: String(v._id),
    name: v.name,
    status: v.status,
    phone: v.phone,
    birthday: v.birthday,
    isMinor: v.isMinor,
    availability: v.availability,
    skills: v.skills,
    interests: v.interests,
    notes: v.notes,
    lastActiveAt: v.lastActiveAt?.toISOString().slice(0, 10),
    missingPaperwork: missingCompliance(v.compliance),
  };
}

export const addVolunteer = defineTool({
  name: 'add_volunteer',
  description: 'Add a new volunteer. Only `name` is required; include whatever else the coordinator mentioned.',
  input: VolunteerFields.extend({ name: z.string().min(1) }),
  async run(ctx, input) {
    const existing = await ctx.c.volunteers.findOne({ nameLower: input.name.toLowerCase() });
    if (existing) return { ok: false, content: `${existing.name} already exists. Use update_volunteer instead.` };
    const now = new Date();
    const doc: Volunteer = {
      name: input.name,
      nameLower: input.name.toLowerCase(),
      phone: input.phone,
      email: input.email,
      birthday: input.birthday,
      isMinor: input.isMinor ?? false,
      availability: input.availability ?? [],
      skills: input.skills ?? [],
      interests: input.interests ?? [],
      notes: input.notes ?? '',
      status: 'onboarding',
      compliance: initialCompliance(input.isMinor ?? false),
      createdAt: now,
      updatedAt: now,
    };
    const vector = await embed(profileText(doc), ctx.log);
    if (vector) doc.notesEmbedding = vector;
    const res = await ctx.c.volunteers.insertOne(doc);
    return { ok: true, content: JSON.stringify({ added: summarize({ ...doc, _id: res.insertedId }) }) };
  },
});

export const updateVolunteer = defineTool({
  name: 'update_volunteer',
  description:
    'Update an existing volunteer found by name. List fields replace the old value; use appendNote to add to notes without losing them.',
  input: VolunteerFields.extend({
    name: z.string().min(1).describe('Name as the coordinator typed it'),
    newName: z.string().optional(),
    status: VolunteerStatus.optional(),
    appendNote: z.string().optional(),
  }),
  async run(ctx, input) {
    const found = await resolveVolunteer(ctx, input.name);
    if ('error' in found) return { ok: false, content: found.error };
    const v = found.volunteer;
    const { name: _n, newName, appendNote, ...rest } = input;
    const next: Volunteer = { ...v, ...stripUndefined(rest), updatedAt: new Date() };
    if (newName) Object.assign(next, { name: newName, nameLower: newName.toLowerCase() });
    if (appendNote) next.notes = [v.notes, appendNote].filter(Boolean).join('\n');
    if (input.isMinor !== undefined && input.isMinor !== v.isMinor) {
      next.compliance = { ...v.compliance, guardianConsent: { status: input.isMinor ? 'missing' : 'not_required' } };
    }
    const vector = await embed(profileText(next), ctx.log);
    const { _id, ...set } = next as Volunteer & { _id: ObjectId };
    if (vector) set.notesEmbedding = vector;
    await ctx.c.volunteers.updateOne({ _id: v._id }, { $set: set });
    return { ok: true, content: JSON.stringify({ updated: summarize(next) }) };
  },
});

export const findVolunteers = defineTool({
  name: 'find_volunteers',
  description:
    'Find volunteers. Use `query` for fuzzy/semantic needs ("good with kids", "can lift heavy boxes") and the filters for exact constraints. With no arguments, lists everyone.',
  input: z.object({
    query: z.string().optional().describe('Free-text description of who is needed; uses semantic vector search'),
    name: z.string().optional(),
    day: Availability.shape.day.optional(),
    part: Availability.shape.part.optional(),
    skill: z.string().optional(),
    status: VolunteerStatus.optional(),
    limit: z.number().int().min(1).max(25).default(10),
  }),
  async run(ctx, input) {
    const results = await searchVolunteers(ctx, input);
    return { ok: true, content: JSON.stringify({ count: results.length, volunteers: results }) };
  },
});

export interface SearchInput {
  query?: string;
  name?: string;
  day?: Volunteer['availability'][number]['day'];
  part?: Volunteer['availability'][number]['part'];
  skill?: string;
  status?: Volunteer['status'];
  limit: number;
  excludeIds?: ObjectId[];
}

/** Vector search when there's a free-text query and embeddings work; plain filters otherwise. */
export async function searchVolunteers(ctx: ToolContext, input: SearchInput) {
  const filter: Record<string, unknown> = {};
  if (input.status) filter.status = input.status;
  if (input.excludeIds?.length) filter._id = { $nin: input.excludeIds };
  // Post-filters (not in the vector index) applied after retrieval.
  const post: Record<string, unknown> = {};
  if (input.day || input.part) {
    post.availability = { $elemMatch: { ...(input.day && { day: input.day }), ...(input.part && { part: input.part }) } };
  }
  if (input.skill) post.skills = { $regex: escapeRegex(input.skill), $options: 'i' };
  if (input.name) post.nameLower = { $regex: escapeRegex(input.name.toLowerCase()) };

  const vector = input.query ? await embed(input.query, ctx.log) : null;
  if (vector) {
    const docs = await ctx.c.volunteers
      .aggregate<Volunteer & { score: number }>([
        {
          $vectorSearch: {
            index: VECTOR_INDEX,
            path: 'notesEmbedding',
            queryVector: vector,
            numCandidates: Math.max(100, input.limit * 20),
            limit: input.limit * 3,
            ...(Object.keys(filter).length && { filter }),
          },
        },
        { $addFields: { score: { $meta: 'vectorSearchScore' } } },
        ...(Object.keys(post).length ? [{ $match: post }] : []),
        { $limit: input.limit },
        { $project: { notesEmbedding: 0 } },
      ])
      .toArray();
    return docs.map((d) => ({ ...summarize(d), matchScore: Number(d.score.toFixed(3)) }));
  }

  // Keyword fallback keeps the tool useful if Bedrock embeddings are unavailable.
  const keyword = input.query
    ? { $or: ['notes', 'skills', 'interests'].map((f) => ({ [f]: { $regex: escapeRegex(input.query!), $options: 'i' } })) }
    : {};
  const docs = await ctx.c.volunteers
    .find({ ...filter, ...post, ...keyword }, { projection: { notesEmbedding: 0 } })
    .limit(input.limit)
    .toArray();
  return docs.map(summarize);
}

export const markPaperwork = defineTool({
  name: 'mark_paperwork',
  description: 'Record that a volunteer turned in (or still needs) an onboarding item.',
  input: z.object({
    name: z.string(),
    item: z.enum(['application', 'waiver', 'emergencyContact', 'codeOfConduct', 'guardianConsent']),
    received: z.boolean().default(true),
    photoKey: z.string().startsWith('inbound/').optional().describe('Storage key of the photo of the signed form, if one was sent'),
  }),
  async run(ctx, input) {
    const found = await resolveVolunteer(ctx, input.name);
    if ('error' in found) return { ok: false, content: found.error };
    const v = found.volunteer;
    const entry = input.received
      ? { status: 'received' as const, receivedAt: new Date(), ...(input.photoKey && { docKey: input.photoKey }) }
      : { status: 'missing' as const };
    const compliance = { ...v.compliance, [input.item]: entry };
    const stillMissing = missingCompliance(compliance);
    // Fully onboarded volunteers become active automatically.
    const status = v.status === 'onboarding' && stillMissing.length === 0 ? 'active' : v.status;
    await ctx.c.volunteers.updateOne({ _id: v._id }, { $set: { compliance, status, updatedAt: new Date() } });
    return { ok: true, content: JSON.stringify({ name: v.name, stillMissing, status }) };
  },
});

export const paperworkStatus = defineTool({
  name: 'paperwork_status',
  description: 'Who is missing which onboarding paperwork (application, waiver, emergency contact, code of conduct, guardian consent for minors).',
  input: z.object({}),
  async run(ctx) {
    const vols = await ctx.c.volunteers.find({ status: { $ne: 'inactive' } }, { projection: { name: 1, compliance: 1 } }).toArray();
    const missing = vols.map((v) => ({ name: v.name, missing: missingCompliance(v.compliance) })).filter((v) => v.missing.length);
    return { ok: true, content: JSON.stringify({ volunteersMissingSomething: missing, complete: vols.length - missing.length }) };
  },
});

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripUndefined = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
