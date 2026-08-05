import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { db } from './db';
import { formatDateTime } from './time';
import type { Replacement, Photo, Operator } from './types';

export interface ReplacementReportFilters {
  fromDate?: string; // yyyy-mm-dd, inclusive
  toDate?: string; // yyyy-mm-dd, inclusive
  block?: string; // e.g. "31", empty = all blocks
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Shrinks an image to a max box before embedding, so a report with many photos stays a
 * reasonable file size instead of ballooning with full-resolution captures. */
function fitImage(dataUrl: string, maxW: number, maxH: number): Promise<{ url: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      resolve({ url: dataUrl, w: img.width * scale, h: img.height * scale });
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
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
    const to = new Date(filters.toDate).getTime() + 24 * 60 * 60 * 1000 - 1; // end of day
    replacements = replacements.filter((r) => new Date(r.replacementDate).getTime() <= to);
  }
  if (filters.block) {
    replacements = replacements.filter((r) => r.locationId.split('.')[0] === filters.block);
  }

  const operators = await db.operators.toArray();
  const operatorName = new Map<string, string>(operators.map((o: Operator) => [o.operatorId, o.name]));

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 32;

  doc.setFontSize(16);
  doc.text('Edenvale Panel Manager -- Replacement Report', margin, 40);
  doc.setFontSize(9);
  doc.setTextColor(110);
  const filterLine = [
    filters.fromDate ? `From ${filters.fromDate}` : null,
    filters.toDate ? `To ${filters.toDate}` : null,
    filters.block ? `Block ${filters.block}` : 'All blocks',
  ]
    .filter(Boolean)
    .join('  ·  ');
  doc.text(`Generated ${new Date().toLocaleString()}  ·  ${filterLine}  ·  ${replacements.length} replacement(s)`, margin, 56);
  doc.setTextColor(0);

  // Summary table.
  autoTable(doc, {
    startY: 72,
    head: [['Location', 'Date', 'Removed SN', 'Installed SN', 'Voltage', 'Replaced by', 'SM ID', 'Reason']],
    body: replacements.map((r) => [
      r.locationId,
      formatDateTime(r.replacementDate),
      r.removedSerial,
      r.installedSerial,
      r.newVoltage !== undefined ? `${r.newVoltage}V` : '-',
      operatorName.get(r.replacedBy) ?? r.replacedBy,
      r.smUploaded ? r.sunManagerId || 'yes' : r.sunManagerId ? `${r.sunManagerId} (pending)` : '-',
      r.reason || '-',
    ]),
    styles: { fontSize: 7, cellPadding: 3 },
    headStyles: { fillColor: [74, 144, 217] },
    margin: { left: margin, right: margin },
  });

  // Per-replacement detail pages with before/after photos, for anything that has them.
  const withPhotos = replacements.filter((r) => r.photoIds.length > 0);
  for (let i = 0; i < withPhotos.length; i++) {
    const r = withPhotos[i];
    onProgress?.(`Adding photos (${i + 1}/${withPhotos.length})...`);
    const photos = (await db.photos.bulkGet(r.photoIds)).filter((p): p is Photo => !!p);
    if (photos.length === 0) continue;

    doc.addPage();
    doc.setFontSize(12);
    doc.text(`${r.locationId} -- ${formatDateTime(r.replacementDate)}`, margin, 40);
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text(
      `${r.removedSerial} -> ${r.installedSerial}   ·   ${operatorName.get(r.replacedBy) ?? r.replacedBy}${
        r.newVoltage !== undefined ? `   ·   ${r.newVoltage}V` : ''
      }`,
      margin,
      56
    );
    doc.setTextColor(0);

    const before = photos.filter((p) => p.photoRole === 'before');
    const after = photos.filter((p) => p.photoRole !== 'before');
    const colW = (pageW - margin * 2 - 16) / 2;
    let y = 76;

    async function drawColumn(label: string, list: Photo[], x: number) {
      doc.setFontSize(10);
      doc.text(label, x, y);
      let cy = y + 14;
      for (const p of list) {
        try {
          const dataUrl = await blobToDataUrl(p.blob);
          const fitted = await fitImage(dataUrl, colW, 180);
          if (cy + fitted.h > doc.internal.pageSize.getHeight() - margin) {
            doc.addPage();
            cy = margin;
          }
          doc.addImage(fitted.url, 'JPEG', x, cy, fitted.w, fitted.h);
          cy += fitted.h + 10;
        } catch {
          // skip a single unreadable photo rather than fail the whole report
        }
      }
    }

    await drawColumn('Before', before, margin);
    await drawColumn('After', after, margin + colW + 16);
  }

  return doc.output('blob');
}
