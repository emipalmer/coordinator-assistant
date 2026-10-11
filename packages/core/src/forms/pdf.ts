import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { displayValue } from './engine.js';
import { guardianConsent } from './templates.js';
import type { FormTemplate, FormValues } from './types.js';
import type { ImpactReport } from './impact.js';

const PAGE = { w: 612, h: 792, margin: 54 };
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.44, 0.48);
const RULE = rgb(0.82, 0.83, 0.86);
const ACCENT = rgb(0.13, 0.4, 0.33);

// Standard fonts only encode WinAnsi; model-written text often has curly quotes, dashes, or emoji.
export function toWinAnsi(s: string): string {
  return s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
}

/** Minimal flowing layout: tracks the cursor and starts new pages as needed. */
class Layout {
  page!: PDFPage;
  y = 0;
  constructor(private doc: PDFDocument, private font: PDFFont, private bold: PDFFont, private footer: string) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage([PAGE.w, PAGE.h]);
    this.y = PAGE.h - PAGE.margin;
    this.page.drawText(toWinAnsi(this.footer), { x: PAGE.margin, y: 30, size: 8, font: this.font, color: MUTED });
  }
  ensure(h: number) {
    if (this.y - h < PAGE.margin) this.newPage();
  }
  wrap(text: string, size: number, font: PDFFont, width: number): string[] {
    const lines: string[] = [];
    for (const para of toWinAnsi(text).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const tryLine = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(tryLine, size) > width && line) {
          lines.push(line);
          line = word;
        } else line = tryLine;
      }
      lines.push(line);
    }
    return lines;
  }
  text(s: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const x = PAGE.margin + (opts.indent ?? 0);
    for (const line of this.wrap(s, size, font, PAGE.w - PAGE.margin - x)) {
      this.ensure(size + 4);
      this.y -= size + 4;
      this.page.drawText(line, { x, y: this.y, size, font, color: opts.color ?? INK });
    }
    this.y -= opts.gap ?? 0;
  }
  rule(gap = 8) {
    this.ensure(gap * 2);
    this.y -= gap;
    this.page.drawLine({ start: { x: PAGE.margin, y: this.y }, end: { x: PAGE.w - PAGE.margin, y: this.y }, thickness: 0.6, color: RULE });
    this.y -= gap;
  }
  section(title: string) {
    this.ensure(40);
    this.y -= 10;
    this.text(title.toUpperCase(), { size: 9, bold: true, color: ACCENT, gap: 2 });
  }
  /** Label on the left, value (or a blank line to write on) on the right. */
  field(label: string, value: string) {
    const labelW = 170;
    const x = PAGE.margin + labelW;
    const lines = value ? this.wrap(value, 10, this.font, PAGE.w - PAGE.margin - x) : [''];
    this.ensure(lines.length * 14 + 6);
    this.y -= 14;
    this.page.drawText(toWinAnsi(label), { x: PAGE.margin, y: this.y, size: 9, font: this.font, color: MUTED });
    if (!value) {
      this.page.drawLine({ start: { x, y: this.y - 2 }, end: { x: PAGE.w - PAGE.margin, y: this.y - 2 }, thickness: 0.5, color: RULE });
    }
    lines.forEach((l, i) => this.page.drawText(l, { x, y: this.y - i * 14, size: 10, font: this.font, color: INK }));
    this.y -= (lines.length - 1) * 14 + 4;
  }
  signature(label: string) {
    this.ensure(44);
    this.y -= 34;
    const mid = PAGE.margin + 300;
    this.page.drawLine({ start: { x: PAGE.margin, y: this.y }, end: { x: mid - 20, y: this.y }, thickness: 0.6, color: INK });
    this.page.drawLine({ start: { x: mid, y: this.y }, end: { x: PAGE.w - PAGE.margin, y: this.y }, thickness: 0.6, color: INK });
    this.page.drawText(toWinAnsi(label), { x: PAGE.margin, y: this.y - 11, size: 8, font: this.font, color: MUTED });
    this.page.drawText('Date', { x: mid, y: this.y - 11, size: 8, font: this.font, color: MUTED });
  }
}

async function start(title: string, orgName: string, subtitle: string, footer: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(toWinAnsi(title));
  doc.setProducer('Coordinator Assistant');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const l = new Layout(doc, font, bold, footer);
  l.text(orgName, { size: 10, color: MUTED });
  l.text(title, { size: 20, bold: true, gap: 2 });
  if (subtitle) l.text(subtitle, { size: 10, color: MUTED });
  l.rule();
  return { doc, l };
}

export interface RenderMeta {
  orgName: string;
  generatedLabel: string; // e.g. "Generated Oct 11, 2026"
  isMinor?: boolean;
}

/** Any FormTemplate -> PDF. Coordinator forms print values; volunteer packets leave blanks to fill by hand. */
export async function renderFormPdf(t: FormTemplate, values: FormValues, meta: RenderMeta): Promise<Uint8Array> {
  const subtitle = t.filledBy === 'volunteer' ? 'Please complete, sign, and return to the volunteer coordinator.' : '';
  const { doc, l } = await start(t.title, meta.orgName, subtitle, `${meta.orgName} - ${t.title} - ${meta.generatedLabel}`);
  let section = '';
  for (const f of t.fields) {
    if (f.section && f.section !== section) {
      section = f.section;
      l.section(section);
    }
    l.field(f.label, displayValue(f, values[f.key]));
  }
  for (const b of t.boilerplate ?? []) {
    l.section(b.heading);
    l.text(b.body, { size: 9.5, gap: 4 });
  }
  if (t.signatures?.length) {
    l.section('Signatures');
    t.signatures.forEach((s) => l.signature(s));
  }
  if (meta.isMinor && t.id === 'onboarding_packet') {
    l.newPage();
    l.section(guardianConsent.heading);
    l.text(guardianConsent.body, { size: 9.5, gap: 4 });
    guardianConsent.signatures.forEach((s) => l.signature(s));
  }
  return doc.save();
}

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function renderImpactPdf(r: ImpactReport, meta: RenderMeta & { monthLabel: string }): Promise<Uint8Array> {
  const { doc, l } = await start(`Volunteer Impact Report: ${meta.monthLabel}`, meta.orgName, '', `${meta.orgName} - Impact report - ${meta.generatedLabel}`);
  l.section('Summary');
  l.field('Volunteer hours', String(r.totalHours));
  l.field('Estimated value of volunteer time', `${usd(r.estimatedValueUsd)} (at ${usd(r.hourlyValueUsd)}/hour)`);
  l.field('Active volunteers', String(r.activeVolunteers));
  l.field('New volunteers', String(r.newVolunteers));
  l.field('Shifts held', String(r.shiftsHeld));
  l.field('Average hours per active volunteer', String(r.avgHoursPerVolunteer));
  if (r.byActivity.length) {
    l.section('Hours by activity');
    r.byActivity.forEach((a) => l.field(a.activity, `${a.hours} h`));
  }
  if (r.topVolunteers.length) {
    l.section('Most hours this month');
    r.topVolunteers.forEach((v) => l.field(v.name, `${v.hours} h`));
  }
  l.section('Method');
  l.text(
    `Hours come from attendance logged by the volunteer coordinator. Estimated value = total hours x ${usd(r.hourlyValueUsd)} per hour, the rate configured by the organization.`,
    { size: 9, color: MUTED },
  );
  return doc.save();
}
