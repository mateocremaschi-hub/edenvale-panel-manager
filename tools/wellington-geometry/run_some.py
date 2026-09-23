import re, glob, json, subprocess, sys
pdfs = sorted(glob.glob('WEN-ISE-CV-DRW-0007-*.pdf'))
block_pdf = {}
for p in pdfs:
    m = re.search(r'BLOCKS?\s*\.?\s*(\d+)(?:\s*&\s*(\d+))?', p)
    for b in (m.groups() if m else ()):
        if b: block_pdf[int(b)] = p
xlsx = 'WEN-ISE-EL-SCH-0006_A1 - List of Strings.xlsx'
for b in map(int, sys.argv[1:]):
    out = subprocess.run([sys.executable, 'extract_block.py', block_pdf[b], xlsx, str(b), 'out'], capture_output=True, text=True)
    lines = [l for l in out.stdout.splitlines() if not l.startswith('warning')]
    r = json.loads('\n'.join(lines))
    print(f"block {b:02d}: trk={r['trackers']} bars={r['bars_found']}/{r['bars_total']} north={r['north']} short={r['short']} axis={r['axis']} road={r['road']} chains={r['chains']}")
