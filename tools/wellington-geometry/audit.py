import json, glob, os
from collections import Counter
rows = []
for f in sorted(glob.glob('out/[0-9][0-9].json')):
    g = json.load(open(f))
    b = g['block']
    n_tr = len(g['trackers'])
    rows_per_tracker = Counter(len(t['rows']) for t in g['trackers'].values())
    # strings per tracker-row
    spr = Counter()
    per_tr_row = Counter((s['t'], s['r']) for s in g['strings'])
    for k, v in per_tr_row.items(): spr[v] += 1
    dc_no = sum(1 for t in g['trackers'].values() if not t.get('dcbox'))
    rows.append((b, n_tr, len(g['strings']), len(g['dcbox']), dict(rows_per_tracker), dict(spr), dc_no, g['w'], g['h']))
print(f"{'blk':>3} {'trk':>4} {'str':>4} {'dcb':>4}  rows/tracker      strings/tracker-row   sinDC   img")
for r in rows:
    print(f"{r[0]:>3} {r[1]:>4} {r[2]:>4} {r[3]:>4}  {str(r[4]):<17} {str(r[5]):<21} {r[6]:>4}   {r[7]}x{r[8]}")
print()
print('bloques procesados:', len(rows), '| total trackers:', sum(r[1] for r in rows), '| total strings:', sum(r[2] for r in rows))
