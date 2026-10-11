import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { renderFormPdf, renderImpactPdf, toWinAnsi } from './pdf.js';
import { incidentReport, onboardingPacket } from './templates.js';

const meta = { orgName: 'Maple Street Community Pantry', generatedLabel: 'Generated Oct 11, 2026' };

describe('pdf rendering', () => {
  it('renders a filled incident report, surviving curly quotes and emoji', async () => {
    const bytes = await renderFormPdf(incidentReport, { description: 'Sam’s hand got caught — minor cut 🩹', firstAidGiven: true }, meta);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });
  it('adds a guardian consent page for minors only', async () => {
    const adult = await PDFDocument.load(await renderFormPdf(onboardingPacket, { name: 'A' }, meta));
    const minor = await PDFDocument.load(await renderFormPdf(onboardingPacket, { name: 'J' }, { ...meta, isMinor: true }));
    expect(minor.getPageCount()).toBe(adult.getPageCount() + 1);
  });
  it('renders an impact report', async () => {
    const bytes = await renderImpactPdf(
      { totalHours: 9.5, shiftsHeld: 3, activeVolunteers: 2, newVolunteers: 1, estimatedValueUsd: 285, hourlyValueUsd: 30, avgHoursPerVolunteer: 4.8, byActivity: [], topVolunteers: [] },
      { ...meta, monthLabel: 'September 2026' },
    );
    expect(bytes.length).toBeGreaterThan(1000);
  });
  it('maps typographic characters to WinAnsi', () => {
    expect(toWinAnsi('“Hi” – it’s… 🎉')).toBe('"Hi" - it\'s... ');
  });
});
