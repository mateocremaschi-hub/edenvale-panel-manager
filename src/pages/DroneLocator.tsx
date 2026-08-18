import { useState } from 'react';
import { Link } from 'react-router-dom';
import * as exifr from 'exifr';
import { db } from '@/lib/db';
import { displaySerial } from '@/lib/panelDisplay';
import { parsePicaExcelFile, importTrackerPicas, findNearestPanel, type PicaImportRow, type PanelMatch } from '@/lib/dronePicas';

export default function DroneLocator() {
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<PicaImportRow[] | null>(null);
  const [importCount, setImportCount] = useState<number | null>(null);
  const [picaTotal, setPicaTotal] = useState<number | null>(null);

  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [match, setMatch] = useState<PanelMatch | null>(null);
  const [manualLat, setManualLat] = useState('');
  const [manualLon, setManualLon] = useState('');

  async function refreshPicaTotal() {
    setPicaTotal(await db.trackerPicas.count());
  }
  useState(() => {
    refreshPicaTotal();
  });

  async function onPicaFile(file: File) {
    setImportError(null);
    setImportPreview(null);
    setImportCount(null);
    try {
      const rows = await parsePicaExcelFile(file);
      setImportPreview(rows);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  }

  async function confirmImport() {
    if (!importPreview) return;
    setImportBusy(true);
    try {
      const n = await importTrackerPicas(importPreview);
      setImportCount(n);
      setImportPreview(null);
      await refreshPicaTotal();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportBusy(false);
    }
  }

  async function runLookup(lat: number, lon: number) {
    setLookupError(null);
    setMatch(null);
    setLookupBusy(true);
    try {
      const result = await findNearestPanel({ lat, lon });
      if (!result) {
        setLookupError('No tracker GPS data loaded yet -- import the pica Excel first.');
        return;
      }
      setMatch(result);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : String(err));
    } finally {
      setLookupBusy(false);
    }
  }

  async function onPhotoFile(file: File) {
    setLookupError(null);
    setMatch(null);
    try {
      const gps = await exifr.gps(file);
      if (!gps) {
        setLookupError("This photo doesn't have GPS location saved in it. Try typing the coordinates instead.");
        return;
      }
      await runLookup(gps.latitude, gps.longitude);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col gap-6 pb-20">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Locate panel from drone photo</h1>
        <p className="mt-1 text-sm text-slate-400">
          Upload a thermal-inspection drone photo (or type its coordinates) and this finds the closest panel,
          using the tracker GPS survey data.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-bg-panel p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-200">Find a panel</h2>
        {lookupError && <div className="mb-3 rounded-lg bg-status-pending/20 p-2 text-xs text-status-pending">{lookupError}</div>}

        <label className="mb-3 inline-block cursor-pointer rounded-lg bg-accent-blue px-4 py-2 text-sm font-semibold text-white">
          📷 Upload drone photo
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onPhotoFile(e.target.files[0])}
          />
        </label>

        <div className="mb-2 mt-2 text-xs text-slate-500">or type coordinates directly (e.g. from an external company's list):</div>
        <div className="flex flex-wrap gap-2">
          <input
            value={manualLat}
            onChange={(e) => setManualLat(e.target.value)}
            placeholder="Latitude, e.g. -26.9189"
            className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
          />
          <input
            value={manualLon}
            onChange={(e) => setManualLon(e.target.value)}
            placeholder="Longitude, e.g. 150.5746"
            className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-slate-100"
          />
          <button
            onClick={() => runLookup(Number(manualLat), Number(manualLon))}
            disabled={!manualLat || !manualLon}
            className="rounded-lg bg-accent-teal px-4 py-2 text-sm font-semibold text-bg-panel disabled:opacity-40"
          >
            Find
          </button>
        </div>

        {lookupBusy && <p className="mt-3 text-xs text-slate-400">Searching...</p>}

        {match && (
          <div className="mt-4 rounded-lg border border-accent-blue/40 bg-accent-blue/10 p-4">
            <div className="text-sm text-slate-300">
              Block <span className="font-semibold text-slate-100">{match.block}</span>, Tracker{' '}
              <span className="font-semibold text-slate-100">{match.tracker}</span>
              {match.row && <> ({match.row})</>}, module <span className="font-semibold text-slate-100">{match.position}</span>{' '}
              {match.locationId ? 'of 28' : '(of 56 along the row -- string not resolved yet)'}
            </div>
            {match.positionUnconfirmed && (
              <div className="mt-1 text-xs text-status-pending">
                ⚠ Couldn't load this block's map data, so the North/South panel position couldn't be
                double-checked -- the position number above may be off. Try again once online.
              </div>
            )}
            {match.locationId ? (
              <>
                <div className="mt-1 font-mono text-xs text-slate-400">{match.locationId}</div>
                {match.serialNumber && (
                  <div className="mt-1 font-mono text-sm text-slate-100">{displaySerial(match.serialNumber)}</div>
                )}
                <Link to={`/replacements?panelId=${encodeURIComponent(match.locationId)}`} className="mt-3 inline-block text-xs text-accent-blue">
                  Open in Replacements →
                </Link>
              </>
            ) : (
              <div className="mt-1 text-xs text-status-pending">
                Couldn't resolve the exact panel code (this block's map geometry may not be loaded) -- but the
                block/tracker/position above should be enough to find it on the map.
              </div>
            )}
            <div className="mt-2 text-xs text-slate-500">Match confidence: ~{match.distanceM.toFixed(1)}m from the estimated panel position.</div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-bg-panel p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-200">Tracker GPS data</h2>
        <p className="mb-3 text-xs text-slate-500">
          {picaTotal !== null && picaTotal > 0 ? `${picaTotal} tracker row(s) loaded.` : 'No tracker GPS data loaded yet.'} Upload
          the drone survey Excel (pica1/pica2 north/south coordinates per tracker) to add more blocks.
        </p>
        {importError && <div className="mb-3 rounded-lg bg-status-pending/20 p-2 text-xs text-status-pending">{importError}</div>}
        {importCount !== null && (
          <div className="mb-3 rounded-lg bg-status-replaced/20 p-2 text-xs text-status-replaced">
            ✓ Imported {importCount} tracker row(s).
          </div>
        )}

        {importPreview && (
          <div className="mb-3 rounded-lg border border-border p-3 text-xs">
            <div className="mb-2 font-semibold text-slate-300">
              Found {importPreview.length} row(s). Preview of the first 3 (converted to lat/lon):
            </div>
            {importPreview.slice(0, 3).map((r, i) => (
              <div key={i} className="border-t border-border py-1 font-mono text-slate-400">
                Block {r.block}, Tracker {r.tracker} ({r.isMotorRow ? 'motor' : 'slave'}) -- N: {r.north.lat.toFixed(5)},{' '}
                {r.north.lon.toFixed(5)} · S: {r.south.lat.toFixed(5)}, {r.south.lon.toFixed(5)}
              </div>
            ))}
            <button
              onClick={confirmImport}
              disabled={importBusy}
              className="mt-3 rounded-lg bg-accent-blue px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              {importBusy ? 'Importing...' : 'Looks right -- import'}
            </button>
          </div>
        )}

        {!importPreview && (
          <label className="inline-block cursor-pointer rounded-lg border border-border px-4 py-2 text-sm font-semibold text-slate-300">
            Choose pica Excel file
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onPicaFile(e.target.files[0])}
            />
          </label>
        )}
      </section>
    </div>
  );
}
