// Demo helper: render a SYNTHETIC onboarding packet that looks filled in and signed, as a PDF.
// Convert to a photo-like JPEG with: sips -s format jpeg out.pdf --out out.jpg
//   npx tsx scripts/fake-signed-form.ts "Riley Johnson" out.pdf
import { writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { onboardingPacket, renderFormPdf } from '@app/core';

const [name = 'Riley Johnson', out = 'signed.pdf'] = process.argv.slice(2);
const base = await renderFormPdf(
  onboardingPacket,
  { name, phone: '+16105550111', email: 'riley.j@example.com', interests: 'Compost program, animals', emergencyName: 'Sam Johnson', emergencyRelationship: 'Parent', emergencyPhone: '+16105550188' },
  { orgName: 'Maple Street Community Pantry', generatedLabel: 'Prepared Oct 11, 2026' },
);
const doc = await PDFDocument.load(base);
const script = await doc.embedFont(StandardFonts.TimesRomanItalic);
const page = doc.getPages().at(-1)!;
// Rough "handwriting" on the volunteer signature line near the bottom of the last page.
const sigY = page.getHeight() - 508;
page.drawText(name, { x: 60, y: sigY, size: 22, font: script, color: rgb(0.1, 0.15, 0.45), rotate: { type: 'degrees' as never, angle: 2 } as never });
page.drawText('10/11/2026', { x: 365, y: sigY, size: 14, font: script, color: rgb(0.1, 0.15, 0.45) });
writeFileSync(out, await doc.save());
console.log(`wrote ${out}`);
