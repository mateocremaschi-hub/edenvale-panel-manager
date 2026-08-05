import jsPDF from 'jspdf';
import { db } from './db';
import { GRS_LOGO_PNG_BASE64 } from './assets/grsLogo';
import type { Replacement, Issue, Photo, Operator } from './types';

export interface ReplacementReportFilters {
  fromDate?: string; // yyyy-mm-dd, inclusive
  toDate?: string; // yyyy-mm-dd, inclusive
  block?: string; // e.g. "31", empty = all blocks
}

const RED: [number, number, number] = [152, 40, 40]; // GRS brand red, matches the template
const GREY: [number, number, number] = [217, 217, 217];
const MARGIN = 32;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function fitImage(img: HTMLImageElement, maxW: number, maxH: number) {
  const scale = Math.min(maxW / img.width, maxH / img.height, 1);
  return { w: img.width * scale, h: img.height * scale };
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function shortId(id: string): string {
  const parts = id.split('_');
  return (parts[1] ?? id).slice(0, 8).toUpperCase();
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Red section header bar, full given width, centered bold white text -- matches the
 * "Problem" / "Solution" / "Works" / etc bars in the GRS Corrective Report template. */
function sectionBar(doc: jsPDF, label: string, x: number, y: number, w: number, h = 18) {
  doc.setFillColor(...RED);
  doc.rect(x, y, w, h, 'F');
  doc.setDrawColor(0);
  doc.rect(x, y, w, h);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(label, x + w / 2, y + h / 2 + 3, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
}

/** One label|value pair styled like the template's info-grid cells: red filled label on
 * the left, bordered blank/value box to the right. */
function labelValue(doc: jsPDF, label: string, value: string, x: number, y: number, labelW: number, valueW: number, h: number) {
  doc.setFillColor(...RED);
  doc.rect(x, y, labelW, h, 'F');
  doc.rect(x, y, labelW, h);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(label, x + 4, y + h / 2 + 3);

  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  doc.rect(x + labelW, y, valueW, h);
  doc.text(value, x + labelW + 4, y + h / 2 + 3, { maxWidth: valueW - 8 });
}

async function drawDataPage(
  doc: jsPDF,
  r: Replacement,
  relatedIssue: Issue | undefined,
  operatorName: string,
  pageW: number
) {
  const innerW = pageW - MARGIN * 2;

  // Header: logo + title, boxed.
  const headerH = 46;
  doc.rect(MARGIN, MARGIN, innerW, headerH);
  try {
    const logo = await loadImage(GRS_LOGO_PNG_BASE64);
    const fitted = fitImage(logo, 110, headerH - 14);
    doc.addImage(GRS_LOGO_PNG_BASE64, 'PNG', MARGIN + 8, MARGIN + (headerH - fitted.h) / 2, fitted.w, fitted.h);
  } catch {
    // logo failed to decode -- proceed without it rather than fail the whole report
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('CORRECTIVE REPORT', MARGIN + 160, MARGIN + headerH / 2 + 4);
  doc.setFont('helvetica', 'normal');

  let y = MARGIN + headerH + 8;

  // Incidence Number / Affected Area (label ~40%, value ~60%).
  const labelW1 = innerW * 0.4;
  labelValue(doc, 'Incidence Number:', shortId(r.replacementId), MARGIN, y, labelW1, innerW - labelW1, 18);
  y += 18;
  labelValue(doc, 'Affected Area:', r.locationId, MARGIN, y, labelW1, innerW - labelW1, 18);
  y += 18 + 8;

  // 3x3 info grid.
  const colW = innerW / 6;
  const rows: [string, string, string, string, string, string][] = [
    ['Date:', fmtDate(relatedIssue?.reportedDate ?? r.replacementDate), 'End date:', fmtDate(r.replacementDate), 'Installation:', 'Edenvale Solar Farm'],
    ['Worktype:', 'Panel replacement', 'Status:', 'Completed', 'Equipment:', 'PV Module'],
    [
      'Priority:',
      relatedIssue ? relatedIssue.severity.replace(/_/g, ' ') : '-',
      'Technician:',
      operatorName,
      'Parts:',
      r.installedSerial,
    ],
  ];
  for (const row of rows) {
    for (let i = 0; i < 3; i++) {
      labelValue(doc, row[i * 2], row[i * 2 + 1], MARGIN + colW * i * 2, y, colW, colW, 18);
    }
    y += 18;
  }
  y += 10;

  // Problem.
  sectionBar(doc, 'Problem', MARGIN, y, innerW);
  y += 18;
  const problemH = 60;
  doc.rect(MARGIN, y, innerW, problemH);
  const problemText = relatedIssue
    ? `${relatedIssue.type.replace(/_/g, ' ')}${relatedIssue.description ? ' -- ' + relatedIssue.description : ''}`
    : 'No linked report -- registered directly as a replacement.';
  doc.setFontSize(9);
  doc.text(doc.splitTextToSize(problemText, innerW - 10), MARGIN + 5, y + 12);
  y += problemH + 10;

  // Solution.
  sectionBar(doc, 'Solution', MARGIN, y, innerW);
  y += 18;
  const solutionH = 60;
  doc.rect(MARGIN, y, innerW, solutionH);
  const solutionText = [r.reason, r.notes].filter(Boolean).join('\n') || '-';
  doc.text(doc.splitTextToSize(solutionText, innerW - 10), MARGIN + 5, y + 12);
  y += solutionH + 10;

  // Works table.
  sectionBar(doc, 'Works', MARGIN, y, innerW);
  y += 18;
  const workCols = [0.12, 0.16, 0.16, 0.18, 0.38].map((f) => f * innerW);
  const workHeaders = ['ID', 'Start', 'End', 'Technician', 'Description'];
  doc.setFillColor(...GREY);
  doc.rect(MARGIN, y, innerW, 16, 'F');
  let cx = MARGIN;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  for (let i = 0; i < workHeaders.length; i++) {
    doc.rect(cx, y, workCols[i], 16);
    doc.text(workHeaders[i], cx + 3, y + 11);
    cx += workCols[i];
  }
  doc.setFont('helvetica', 'normal');
  y += 16;
  const workRowH = 18;
  const workValues = [shortId(r.replacementId), fmtDate(relatedIssue?.reportedDate ?? r.replacementDate), fmtDate(r.replacementDate), operatorName, r.reason || '-'];
  cx = MARGIN;
  for (let i = 0; i < workValues.length; i++) {
    doc.rect(cx, y, workCols[i], workRowH);
    doc.text(String(workValues[i]), cx + 3, y + 12, { maxWidth: workCols[i] - 6 });
    cx += workCols[i];
  }
  y += workRowH;
  doc.rect(MARGIN, y, innerW, workRowH); // one trailing blank row, matches the template
  y += workRowH + 10;

  // Spare Part table.
  sectionBar(doc, 'Spare Part', MARGIN, y, innerW);
  y += 18;
  const partCols = [0.2, 0.5, 0.15, 0.15].map((f) => f * innerW);
  const partHeaders = ['Code Part', 'Name', 'Units', 'Date'];
  doc.setFillColor(...GREY);
  doc.rect(MARGIN, y, innerW, 16, 'F');
  cx = MARGIN;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  for (let i = 0; i < partHeaders.length; i++) {
    doc.rect(cx, y, partCols[i], 16);
    doc.text(partHeaders[i], cx + 3, y + 11);
    cx += partCols[i];
  }
  doc.setFont('helvetica', 'normal');
  y += 16;
  const voltageNote = r.newVoltage !== undefined ? ` (${r.newVoltage}V)` : '';
  const partValues = [r.installedSerial, `PV Panel${voltageNote}`, '1', fmtDate(r.replacementDate)];
  cx = MARGIN;
  for (let i = 0; i < partValues.length; i++) {
    doc.rect(cx, y, partCols[i], workRowH);
    doc.text(String(partValues[i]), cx + 3, y + 12, { maxWidth: partCols[i] - 6 });
    cx += partCols[i];
  }
  y += workRowH;
  doc.rect(MARGIN, y, innerW, workRowH);
}

async function drawPhotoPage(doc: jsPDF, photos: Photo[], pageW: number, pageH: number) {
  doc.addPage();
  const innerW = pageW - MARGIN * 2;
  let y = MARGIN;

  sectionBar(doc, 'Photographic Report', MARGIN, y, innerW);
  y += 18;

  const colW = innerW / 2 - 4;
  sectionBar(doc, 'Previous Work', MARGIN, y, colW, 16);
  sectionBar(doc, 'After Work', MARGIN + colW + 8, y, colW, 16);
  y += 16;

  const before = photos.filter((p) => p.photoRole === 'before');
  const after = photos.filter((p) => p.photoRole !== 'before');

  doc.setFillColor(...GREY);
  doc.rect(MARGIN, y, colW, 14, 'F');
  doc.rect(MARGIN + colW + 8, y, colW, 14, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text(`File name: ${before.length ? before.length + ' photo(s)' : '-'}`, MARGIN + 3, y + 10);
  doc.text(`File name: ${after.length ? after.length + ' photo(s)' : '-'}`, MARGIN + colW + 11, y + 10);
  doc.setFont('helvetica', 'normal');
  y += 14;

  const boxTop = y;
  const boxH = pageH - MARGIN - boxTop;
  doc.rect(MARGIN, boxTop, colW, boxH);
  doc.rect(MARGIN + colW + 8, boxTop, colW, boxH);

  async function drawStack(list: Photo[], x: number) {
    let cy = boxTop + 6;
    for (const p of list) {
      try {
        const dataUrl = await blobToDataUrl(p.blob);
        const img = await loadImage(dataUrl);
        const fitted = fitImage(img, colW - 12, 160);
        if (cy + fitted.h > boxTop + boxH - 6) break; // stop rather than overflow the box
        doc.addImage(dataUrl, 'JPEG', x + 6, cy, fitted.w, fitted.h);
        cy += fitted.h + 8;
      } catch {
        // skip an unreadable photo
      }
    }
    if (list.length === 0) {
      doc.setTextColor(150);
      doc.text('No photo', x + colW / 2, boxTop + boxH / 2, { align: 'center' });
      doc.setTextColor(0);
    }
  }

  await drawStack(before, MARGIN);
  await drawStack(after, MARGIN + colW + 8);
}

export async function generateReplacementsPdf(
  filters: ReplacementReportFilters,
  onProgress?: (text: string) => void
): Promise<Blob> {
  onProgress?.('Gathering replacements...');
  let replacements = await db.replacements.orderBy('replacementDate').toArray();

  if (filters.fromDate) {
    const from = new Date(filters.fromDate).getTime();
    replacements = replacements.filter((r) => new Date(r.replacementDate).getTime() >= from);
  }
  if (filters.toDate) {
    const to = new Date(filters.toDate).getTime() + 24 * 60 * 60 * 1000 - 1;
    replacements = replacements.filter((r) => new Date(r.replacementDate).getTime() <= to);
  }
  if (filters.block) {
    replacements = replacements.filter((r) => r.locationId.split('.')[0] === filters.block);
  }

  const operators = await db.operators.toArray();
  const operatorNameById = new Map<string, string>(operators.map((o: Operator) => [o.operatorId, o.name]));

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  for (let i = 0; i < replacements.length; i++) {
    const r = replacements[i];
    onProgress?.(`Building report ${i + 1}/${replacements.length}...`);
    if (i > 0) doc.addPage();

    const relatedIssue = r.relatedIssueId ? await db.issues.get(r.relatedIssueId) : undefined;
    await drawDataPage(doc, r, relatedIssue, r.replacedByName || operatorNameById.get(r.replacedBy) || r.replacedBy, pageW);

    const photos = (await db.photos.bulkGet(r.photoIds)).filter((p): p is Photo => !!p);
    await drawPhotoPage(doc, photos, pageW, pageH);
  }

  if (replacements.length === 0) {
    doc.setFontSize(12);
    doc.text('No replacements match those filters.', MARGIN, MARGIN);
  }

  return doc.output('blob');
}
