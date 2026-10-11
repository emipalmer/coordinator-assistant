// Synthetic demo data only. Usage:
//   npx tsx --env-file=.env scripts/seed.ts            reset + seed everything
//   npx tsx --env-file=.env scripts/seed.ts --embed    (re)compute embeddings only, once Bedrock works
import { ObjectId } from 'mongodb';
import { createLogger, initialCompliance, localDate, localToUtc, type Availability, type Volunteer } from '@app/core';
import { collections, getDb } from '../services/lambda/src/db.js';
import { embed, EMBEDDING_DIMS } from '../services/lambda/src/embeddings.js';
import { profileText, VECTOR_INDEX } from '../services/lambda/src/tools/volunteers.js';
import { DEFAULT_SETTINGS } from '../services/lambda/src/handlers/agent.js';

const log = createLogger({ svc: 'seed' });
const TZ = DEFAULT_SETTINGS.timezone;
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI not set');
const db = await getDb(uri);
const c = collections(db);
const now = new Date();
const today = localDate(now, TZ);
const dayOffset = (n: number) => localDate(new Date(now.getTime() + n * 86_400_000), TZ);
const md = (offset: number) => {
  const [, m, d] = dayOffset(offset).split('-').map(Number);
  return { month: m!, day: d! };
};
const av = (...s: string[]): Availability[] => s.map((x) => { const [day, part] = x.split(' '); return { day, part } as Availability; });

type Seed = Partial<Volunteer> & { name: string; lastActiveDaysAgo?: number; paperwork?: 'all' | 'none' | 'some' };
const people: Seed[] = [
  { name: 'Sam Rivera', birthday: md(3), availability: av('sat morning', 'sun morning'), skills: ['forklift', 'heavy lifting'], interests: ['animals', 'logistics'], notes: 'Former warehouse worker, great at organizing the stockroom. Has a pickup truck for donation runs.', lastActiveDaysAgo: 6, paperwork: 'all' },
  { name: 'Maria Gonzalez', birthday: md(0), availability: av('sat morning', 'wed evening'), skills: ['spanish', 'intake'], interests: ['community outreach'], notes: 'Bilingual English/Spanish, does client intake and translation. Very warm with families.', lastActiveDaysAgo: 3, paperwork: 'all' },
  { name: 'Maria Chen', birthday: { month: 3, day: 14 }, availability: av('tue evening', 'thu evening'), skills: ['data entry', 'spreadsheets'], interests: ['tech'], notes: 'Accountant by day; helps reconcile inventory counts and donation logs.', lastActiveDaysAgo: 12, paperwork: 'all' },
  { name: 'Jordan Patel', birthday: md(6), isMinor: true, availability: av('sat morning', 'sat afternoon'), skills: ['sorting'], interests: ['kids', 'games'], notes: 'High school junior doing service hours. Great with kids at the family table.', lastActiveDaysAgo: 13, paperwork: 'some' },
  { name: 'Alex Kim', birthday: { month: 7, day: 2 }, availability: av('mon evening', 'wed evening'), skills: ['cooking', 'food safety'], interests: ['nutrition'], notes: 'ServSafe certified line cook. Leads the community meal prep.', lastActiveDaysAgo: 61, paperwork: 'all' },
  { name: 'Priya Shah', birthday: { month: 12, day: 9 }, availability: av('sun afternoon'), skills: ['first aid', 'cpr'], interests: ['health'], notes: 'Nursing student, CPR/First Aid certified. Prefers quieter tasks.', lastActiveDaysAgo: 48, paperwork: 'all' },
  { name: 'Ben Okafor', birthday: { month: 5, day: 21 }, availability: av('sat morning', 'sat afternoon', 'sun morning'), skills: ['heavy lifting', 'driving'], interests: ['sports'], notes: 'College rugby player. Happy to unload trucks and do deliveries; has a clean driving record.', lastActiveDaysAgo: 9, paperwork: 'all' },
  { name: 'Grace Liu', birthday: { month: 1, day: 30 }, availability: av('thu morning', 'fri morning'), skills: ['social media', 'photography'], interests: ['design', 'animals'], notes: 'Retired teacher. Takes photos at events and runs the newsletter.', lastActiveDaysAgo: 20, paperwork: 'all' },
  { name: 'Diego Ramirez', birthday: { month: 9, day: 2 }, availability: av('tue evening', 'sat afternoon'), skills: ['spanish', 'driving'], interests: ['music'], notes: 'Drives the Tuesday grocery rescue route. Bilingual.', lastActiveDaysAgo: 75, paperwork: 'all' },
  { name: 'Hannah Brooks', birthday: { month: 4, day: 18 }, availability: av('wed evening', 'sun morning'), skills: ['intake', 'customer service'], interests: ['kids', 'reading'], notes: 'Runs the kids reading corner on Sundays. Patient and calm.', lastActiveDaysAgo: 2, paperwork: 'all' },
  { name: 'Tomás Silva', birthday: md(12), availability: av('sat morning'), skills: ['carpentry'], interests: ['building'], notes: 'Built the new shelving units. Can do small repairs.', lastActiveDaysAgo: 33, paperwork: 'all' },
  { name: 'Riley Johnson', availability: av('fri evening', 'sat morning'), skills: [], interests: ['animals', 'environment'], notes: 'New volunteer, signed up at the campus fair. Interested in the compost program.', paperwork: 'none' },
  { name: 'Aisha Mohammed', birthday: { month: 11, day: 25 }, isMinor: true, availability: av('sun afternoon'), skills: ['arabic', 'art'], interests: ['kids', 'art'], notes: 'Wants to help with the kids craft table. Speaks Arabic.', paperwork: 'some' },
  { name: 'Chris Walker', birthday: { month: 8, day: 8 }, availability: av('mon morning', 'tue morning'), skills: ['inventory', 'forklift'], interests: ['logistics'], notes: 'Retired logistics manager. Knows the warehouse inside out.', lastActiveDaysAgo: 120, paperwork: 'all' },
];

async function ensureVectorIndex() {
  const existing = await c.volunteers.listSearchIndexes(VECTOR_INDEX).toArray().catch(() => []);
  if (existing.length) return log.info('vector index exists');
  await c.volunteers.createSearchIndex({
    name: VECTOR_INDEX,
    type: 'vectorSearch',
    definition: {
      fields: [
        { type: 'vector', path: 'notesEmbedding', numDimensions: EMBEDDING_DIMS, similarity: 'cosine' },
        { type: 'filter', path: 'status' },
        { type: 'filter', path: '_id' },
      ],
    },
  });
  log.info('vector index created (builds in ~1 min)');
}

async function embedAll() {
  let n = 0;
  for (const v of await c.volunteers.find().toArray()) {
    const vec = await embed(profileText(v), log);
    if (!vec) return log.warn('Bedrock embeddings unavailable; rerun with --embed later', { done: n });
    await c.volunteers.updateOne({ _id: v._id }, { $set: { notesEmbedding: vec } });
    n++;
  }
  log.info('embedded volunteers', { n });
}

if (process.argv.includes('--embed')) {
  await embedAll();
  process.exit(0);
}

await Promise.all(['volunteers', 'shifts', 'assignments', 'attendance', 'conversations', 'settings', 'coordinators', 'formSubmissions'].map((n) => db.collection(n).deleteMany({})));
await c.settings.insertOne(DEFAULT_SETTINGS);

const ids = new Map<string, ObjectId>();
for (const p of people) {
  const isMinor = p.isMinor ?? false;
  const compliance = initialCompliance(isMinor);
  if (p.paperwork === 'all') for (const k of Object.keys(compliance) as Array<keyof typeof compliance>) if (compliance[k].status === 'missing') compliance[k] = { status: 'received', receivedAt: now };
  if (p.paperwork === 'some') { compliance.application = { status: 'received', receivedAt: now }; compliance.codeOfConduct = { status: 'received', receivedAt: now }; }
  const doc: Volunteer = {
    name: p.name, nameLower: p.name.toLowerCase(), birthday: p.birthday, isMinor,
    phone: `+1610555${String(100 + ids.size)}`, // 555-01xx is reserved for fiction
    availability: p.availability ?? [], skills: p.skills ?? [], interests: p.interests ?? [], notes: p.notes ?? '',
    status: p.paperwork === 'all' ? (p.lastActiveDaysAgo && p.lastActiveDaysAgo > 90 ? 'inactive' : 'active') : 'onboarding',
    lastActiveAt: p.lastActiveDaysAgo !== undefined ? localToUtc(dayOffset(-p.lastActiveDaysAgo), TZ) : undefined,
    compliance, createdAt: now, updatedAt: now,
  };
  ids.set(p.name, (await c.volunteers.insertOne(doc)).insertedId);
}

// Past Saturday pantry shifts + attendance for ~10 weeks so the monthly impact report has real numbers.
const rng = mulberry32(42);
for (let w = 1; w <= 10; w++) {
  const day = dayOffset(-7 * w + (6 - new Date(`${today}T12:00:00Z`).getUTCDay()));
  const shiftId = (await c.shifts.insertOne({ title: 'Saturday Pantry', location: 'Main hall', start: localToUtc(`${day}T09:00`, TZ), end: localToUtc(`${day}T13:00`, TZ), capacity: 6, requiredSkills: [], description: 'Sort donations and distribute groceries', status: 'scheduled', createdAt: now })).insertedId;
  for (const p of people) {
    if (p.lastActiveDaysAgo === undefined) continue;
    const dayDate = localToUtc(day, TZ);
    if (dayDate.getTime() > now.getTime() - p.lastActiveDaysAgo * 86_400_000) continue; // don't log after their last active date
    if (rng() < 0.55) await c.attendance.insertOne({ volunteerId: ids.get(p.name)!, shiftId, date: dayDate, hours: [2, 3, 3.5, 4][Math.floor(rng() * 4)]!, activity: 'pantry', createdAt: now });
  }
}

// Upcoming shifts for the demo; Saturday pantry is full so a cancellation triggers a backfill.
const nextSat = dayOffset((6 - new Date(`${today}T12:00:00Z`).getUTCDay() + 7) % 7 || 7);
const upcoming = [
  { title: 'Saturday Pantry', day: nextSat, start: '09:00', end: '13:00', capacity: 4, requiredSkills: ['heavy lifting'], description: 'Unload the food bank truck, sort, and distribute groceries', crew: ['Sam Rivera', 'Maria Gonzalez', 'Ben Okafor', 'Hannah Brooks'] },
  { title: 'Kids Reading Corner', day: dayOffset(((7 - new Date(`${today}T12:00:00Z`).getUTCDay()) % 7) || 7), start: '10:00', end: '12:00', capacity: 3, requiredSkills: [], description: 'Read with children while parents shop', crew: ['Hannah Brooks'] },
  { title: 'Community Meal Prep', day: dayOffset(3), start: '17:00', end: '20:00', capacity: 5, requiredSkills: ['food safety'], description: 'Cook and package the Wednesday community meal', crew: ['Maria Chen'] },
];
for (const s of upcoming) {
  const shiftId = (await c.shifts.insertOne({ title: s.title, location: 'Main hall', start: localToUtc(`${s.day}T${s.start}`, TZ), end: localToUtc(`${s.day}T${s.end}`, TZ), capacity: s.capacity, requiredSkills: s.requiredSkills, description: s.description, status: 'scheduled', createdAt: now })).insertedId;
  for (const n of s.crew) await c.assignments.insertOne({ shiftId, volunteerId: ids.get(n)!, status: 'confirmed', createdAt: now });
}

await c.volunteers.createIndex({ nameLower: 1 });
await c.attendance.createIndex({ volunteerId: 1, date: 1, activity: 1 }, { unique: true });
await c.assignments.createIndex({ shiftId: 1, volunteerId: 1 }, { unique: true });
await c.shifts.createIndex({ start: 1 });
await ensureVectorIndex();
await embedAll();
log.info('seeded', { volunteers: people.length, attendance: await c.attendance.countDocuments() });
process.exit(0);

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
