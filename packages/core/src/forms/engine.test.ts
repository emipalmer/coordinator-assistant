import { describe, expect, it } from 'vitest';
import { applyAnswers, missingFields, nextQuestions, prefill } from './engine.js';
import { incidentReport } from './templates.js';
import { computeImpact } from './impact.js';

const src = { volunteer: { name: 'Sam Rivera', isMinor: false }, orgName: 'Maple Street', today: '2026-10-11', coordinatorName: 'Emilia' };

describe('incident report flow', () => {
  it('prefills from the database and asks only for the rest', () => {
    const v = prefill(incidentReport, src);
    expect(v).toMatchObject({ personName: 'Sam Rivera', reportDate: '2026-10-11', reportedBy: 'Emilia' });
    expect(missingFields(incidentReport, v).map((f) => f.key)).not.toContain('personName');
  });

  it('only requires injury fields for injuries', () => {
    const base = { ...prefill(incidentReport, src), incidentDate: '2026-10-10', incidentTime: '10:15', location: 'dock', description: 'x', personRole: 'volunteer', actionsTaken: 'y' };
    expect(missingFields(incidentReport, { ...base, incidentType: 'near miss' })).toEqual([]);
    const injury = missingFields(incidentReport, { ...base, incidentType: 'injury' }).map((f) => f.key);
    expect(injury).toEqual(['injuryDescription', 'firstAidGiven', 'medicalTreatment']);
    // First-aid details only once first aid is known to have been given.
    expect(missingFields(incidentReport, { ...base, incidentType: 'injury', injuryDescription: 'cut', firstAidGiven: true, medicalTreatment: 'none' }).map((f) => f.key)).toEqual(['firstAidDetails']);
  });

  it('validates and normalizes answers, reporting bad ones without storing them', () => {
    const r = applyAnswers(incidentReport, {}, { incidentTime: '9:05', incidentType: 'Injury', firstAidGiven: 'yes', incidentDate: 'last tuesday', bogus: 1 });
    expect(r.values).toEqual({ incidentTime: '09:05', incidentType: 'injury', firstAidGiven: true });
    expect(r.errors.map((e) => e.key)).toEqual(['incidentDate']);
    expect(r.unknownKeys).toEqual(['bogus']);
  });

  it('asks at most two questions at a time, in form order', () => {
    expect(nextQuestions(incidentReport, {})).toEqual(['What date did it happen?', 'About what time?']);
  });
});

describe('computeImpact', () => {
  const d = (s: string) => new Date(s);
  it('counts only the month and uses the configured hourly value', () => {
    const r = computeImpact({
      attendance: [
        { volunteerId: 'a', date: d('2026-09-05T04:00:00Z'), hours: 4, activity: 'pantry' },
        { volunteerId: 'b', date: d('2026-09-12T04:00:00Z'), hours: 3.5, activity: 'pantry' },
        { volunteerId: 'a', date: d('2026-09-20T04:00:00Z'), hours: 2, activity: 'meal prep' },
        { volunteerId: 'a', date: d('2026-10-03T04:00:00Z'), hours: 9 },
      ],
      volunteers: [{ id: 'a', name: 'Sam', createdAt: d('2026-01-01') }, { id: 'b', name: 'Maria', createdAt: d('2026-09-10') }],
      shiftsHeld: 3,
      hourlyValueUsd: 30,
      monthStart: d('2026-09-01T04:00:00Z'),
      monthEnd: d('2026-10-01T04:00:00Z'),
    });
    expect(r).toMatchObject({ totalHours: 9.5, activeVolunteers: 2, newVolunteers: 1, estimatedValueUsd: 285, avgHoursPerVolunteer: 4.8 });
    expect(r.topVolunteers[0]).toEqual({ name: 'Sam', hours: 6 });
    expect(r.byActivity).toEqual([{ activity: 'pantry', hours: 7.5 }, { activity: 'meal prep', hours: 2 }]);
  });
});
