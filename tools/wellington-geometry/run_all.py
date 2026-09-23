import re, os, json, subprocess, sys, glob
pdfs = sorted(glob.glob('WEN-ISE-CV-DRW-0007-*.pdf'))
# map block number -> pdf from the filename ("BLOCKS 01&02", "BLOCK 34", "BLOCKS 19")
block_pdf = {}
for p in pdfs:
    m = re.search(r'BLOCKS?\s*\.?\s*(\d+)(?:\s*&\s*(\d+))?', p)
    if not m: continue
    for b in m.groups():
        if b: block_pdf[int(b)] = p
missing = [b for b in range(1, 53) if b not in block_pdf]
print('bloques con PDF:', len(block_pdf), '| faltantes:', missing, flush=True)
xlsx = 'WEN-ISE-EL-SCH-0006_A1 - List of Strings.xlsx'
results = {}
for b in sorted(block_pdf):
    out = subprocess.run([sys.executable, 'extract_block.py', block_pdf[b], xlsx, str(b), 'out'], capture_output=True, text=True)
    lines = [l for l in out.stdout.splitlines() if not l.startswith('warning')]
    try:
        r = json.loads('\n'.join(lines))
        results[b] = r
        print(f"block {b:02d}: trk={r['trackers']} bars={r['bars_found']}/{r['bars_total']} str={r['strings']} dcb={r['dcbox']} north={r['north']} short={r['short']} axis={r['axis']} road={r['road']} chains={r['chains']} unmatched_xl={len(r['unmatched_excel'])} unmatched_pdf={len(r['unmatched_pdf'])}", flush=True)
    except Exception as e:
        results[b] = {'error': out.stderr[-800:] or out.stdout[-800:]}
        print(f"block {b:02d}: ERROR {str(e)[:100]}", flush=True)
json.dump(results, open('out/_summary.json', 'w'), indent=1)
print('DONE', flush=True)
