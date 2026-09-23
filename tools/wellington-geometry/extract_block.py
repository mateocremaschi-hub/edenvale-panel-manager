"""Extract Panel Manager geometry for ONE Wellington block from the civil drawing PDF + the
string-list Excel. Produces <out>/<BB>.json (BlockGeometry) and <out>/images/<BB>.png.

Sources and what each contributes:
  - PDF (WEN-ISE-CV-DRW-0007-xx, "MOUNTING STRUCTURE FOUND. & DETAILS"): every tracker is
    drawn as a bar with its FULL label ("34-048-INT-R1-C-L-S2") as rotated text beside it.
    PyMuPDF's get_text('words') reads those cleanly (pdfplumber's default extraction did
    not). The road is the single large grey-filled polygon in the layout area.
  - Excel (WEN-ISE-EL-SCH-0006 "List of Strings"): string -> tracker -> DC box -> inverter for
    the whole farm, one row per string, tracker/DC-box cells only filled on the first row of
    each group (merged-cell export, so carry values down).

Identity rule (learned on block 34): match tracker rows between the two sources on the STABLE
part -- block + tracker number + row (e.g. 34-037 R1) -- never on the full label. The
positional suffix (C / P1N / P1S / P2) disagreed for 3 of 128 trackers between the Excel
(rev A1) and the PDF (rev A3); it is descriptive, not an identifier.

Measured on block 34: every tracker bar is the same length (528 of 528 candidate bars at
183px); EXT/MED/INT is position-in-row per the drawing's own legend, NOT tracker length.
"""
import json, math, re, sys, os
from collections import defaultdict
import fitz  # PyMuPDF
import openpyxl

LABEL_RE = re.compile(r'^(\d{2})-(\d{3})-(INT|EXT|MED)-(R\d)(?:-(.*))?$')
# Label = block-tracker-TYPE-ROW-[position]-LENGTH-[structure]. TYPE (INT/EXT/MED) and position
# (C/P1N/P1S/P2) are where the tracker sits in its row. LENGTH is L (long: 2 strings per row,
# full-length bar) or S (short: 1 string per row, half-length bar -- ~408 farm-wide, at the
# perimeter positions near the inverters). Measured on block 2: short bar = 92px vs 183px.
BAR_LEN_LONG, BAR_LEN_SHORT = 183.0, 92.0

def length_code(suffix):
    parts = suffix.split('-') if suffix else []
    for part in parts:
        if part in ('L', 'S'):
            return part
    return 'L' 
LAYOUT_X_MAX = 10 ** 9  # no fixed cutoff: legend/key plan sit at different x on different sheets (block 15 lost 98 labels to a 1700 cutoff)


def parse_label(label):
    m = LABEL_RE.match(label)
    if not m:
        return None
    block, tnum, typ, row, rest = m.groups()
    return {'block': int(block), 'tnum': tnum, 'type': typ, 'row': row, 'suffix': rest or ''}


def tracker_bars(drawings):
    """Every drawn tracker bar as its centre-line segment ((x1,y1),(x2,y2), length). In these
    sheets a bar is a single 'qu' (quad) path item ~183px long (long tracker) or ~92px (short),
    whatever its orientation. (First attempts used the path bounding box -- which rejects
    diagonal bars -- and then 'l' line items, which these bars are not.)"""
    bars = []
    for d in drawings:
        if d['rect'].x0 > LAYOUT_X_MAX:
            continue
        for it in d['items']:
            if it[0] == 'qu':
                q = it[1]
                ul, ur, ll, lr = q.ul, q.ur, q.ll, q.lr
                w = math.hypot(ur.x - ul.x, ur.y - ul.y)
                h = math.hypot(ll.x - ul.x, ll.y - ul.y)
                if w >= h:
                    a = ((ul.x + ll.x) / 2, (ul.y + ll.y) / 2); b = ((ur.x + lr.x) / 2, (ur.y + lr.y) / 2); L = w
                else:
                    a = ((ul.x + ur.x) / 2, (ul.y + ur.y) / 2); b = ((ll.x + lr.x) / 2, (ll.y + lr.y) / 2); L = h
            elif it[0] == 'l':
                a = (it[1].x, it[1].y); b = (it[2].x, it[2].y); L = math.hypot(b[0] - a[0], b[1] - a[1])
            else:
                continue
            if abs(L - BAR_LEN_LONG) < 8 or abs(L - BAR_LEN_SHORT) < 6:
                bars.append((a, b, L))
    return bars


def line_perp_and_overshoot(px, py, a, b):
    """Perpendicular distance from (px,py) to the infinite line through segment a-b, and how far
    beyond the segment's ends the point's projection falls (0 if within the segment)."""
    ax, ay = a; bx, by = b
    dx, dy = bx - ax, by - ay
    L = math.hypot(dx, dy)
    if L == 0:
        return math.hypot(px - ax, py - ay), 0.0
    ux, uy = dx / L, dy / L
    t = (px - ax) * ux + (py - ay) * uy
    perp = abs((px - ax) * uy - (py - ay) * ux)
    over = 0.0 if 0 <= t <= L else (-t if t < 0 else t - L)
    return perp, over


def point_segment_distance(px, py, a, b):
    ax, ay = a; bx, by = b
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0 if L2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
    qx, qy = ax + t * dx, ay + t * dy
    return math.hypot(px - qx, py - qy)


def load_pdf_trackers(pdf_path, block, drawings=None):
    doc = fitz.open(pdf_path)
    page = doc[0]
    if drawings is None:
        drawings = page.get_drawings()
    bars = tracker_bars(drawings)
    words = page.get_text('words')
    out = {}
    for w in words:
        pl = parse_label(w[4])
        if not pl or pl['block'] != block:
            continue
        cx, cy = (w[0] + w[2]) / 2, (w[1] + w[3]) / 2
        # The label is rotated text drawn ON its bar, at one end. Using the label as the
        # tracker position put rows that touch a road exactly on the road's edge (block 47).
        # The bar whose rect contains the label centre is the tracker-row itself; its centre
        # is the true position -- for side classification and for the map.
        # Labels run ALONG their bar (rotated text). Usually drawn on the bar, but in tight rows
        # (block 15) they are shifted off it by up to ~50px -- still collinear with it. So:
        # collinear (perpendicular < 7px; parallel neighbours sit 18-36px off) and near along the
        # line, nearest first.
        best = None
        for a, b, L in bars:
            perp, over = line_perp_and_overshoot(cx, cy, a, b)
            if perp < 7 and over < 120:
                score = over + perp
                if best is None or score < best[0]:
                    best = (score, a, b, L)
        if best:
            bcx, bcy = (best[1][0] + best[2][0]) / 2, (best[1][1] + best[2][1]) / 2
        else:
            bcx, bcy = cx, cy
        out.setdefault(pl['tnum'], {})[pl['row']] = {'cx': bcx, 'cy': bcy, 'label_cx': cx, 'label_cy': cy,
                                                     'type': pl['type'], 'suffix': pl['suffix'], 'len': length_code(pl['suffix']),
                                                     'bar_found': best is not None}
    return page, out, drawings


def load_excel_strings(xlsx_path, block):
    """tracker key (tnum, row) -> {'strings': [...], 'dcb': ..., 'inv': ...}"""
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    prefix = f'S-{block}.'
    cur = {'tracker': None, 'dcb': None, 'inv': None}
    out = {}
    for row in ws.iter_rows(min_row=3, values_only=True):
        s = row[0]
        if not s or not str(s).startswith(prefix):
            continue
        if row[1]:
            cur['tracker'] = row[1]
        if row[2]:
            cur['dcb'] = row[2]
        if row[6]:
            cur['inv'] = row[6]
        pl = parse_label(cur['tracker'])
        if not pl:
            continue
        key = (pl['tnum'], pl['row'])
        out.setdefault(key, {'strings': [], 'dcb': cur['dcb'], 'inv': cur['inv'], 'type': pl['type']})['strings'].append(s)
    return out


def road_polygons(drawings):
    """All large grey-filled polygons in the layout area (a two-block sheet has two roads).
    Returns list of (area, pts, rect)."""
    out = []
    for d in drawings:
        r = d['rect']
        if r.x0 > LAYOUT_X_MAX or r.width * r.height < 5000:
            continue
        fill = d.get('fill')
        if not fill:
            continue
        if abs(fill[0] - fill[1]) < 0.05 and abs(fill[1] - fill[2]) < 0.05 and 0.3 < fill[0] < 0.95:
            area = r.width * r.height
            if True:
                pts = []
                for it in d['items']:
                    if it[0] == 'l':
                        pts.append((it[1].x, it[1].y)); pts.append((it[2].x, it[2].y))
                    elif it[0] == 'c':
                        pts.append((it[1].x, it[1].y)); pts.append((it[4].x, it[4].y))
                    elif it[0] == 're':
                        rr = it[1]; pts += [(rr.x0, rr.y0), (rr.x1, rr.y0), (rr.x1, rr.y1), (rr.x0, rr.y1)]
                out.append((area, pts, r))
    return out


def fit_line(pts):
    """Least-squares line through points; returns (a, b, c) for a*x + b*y + c = 0, normalised."""
    n = len(pts)
    mx = sum(p[0] for p in pts) / n
    my = sum(p[1] for p in pts) / n
    sxx = sum((p[0] - mx) ** 2 for p in pts)
    sxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
    syy = sum((p[1] - my) ** 2 for p in pts)
    # direction = principal eigenvector of covariance
    theta = 0.5 * math.atan2(2 * sxy, sxx - syy)
    dx, dy = math.cos(theta), math.sin(theta)
    a, b = -dy, dx
    c = -(a * mx + b * my)
    return a, b, c


def side_of(line, x, y):
    a, b, c = line
    return a * x + b * y + c


def build_chains(trackers):
    """Group trackers into row-chains by walking tracker numbers in order and breaking where the
    gap to the previous tracker is much larger than the typical neighbour spacing."""
    order = sorted(trackers.keys(), key=int)
    gaps = []
    for i in range(1, len(order)):
        a, b = trackers[order[i - 1]], trackers[order[i]]
        gaps.append(math.hypot(a['cx'] - b['cx'], a['cy'] - b['cy']))
    gaps_sorted = sorted(gaps)
    typical = gaps_sorted[len(gaps_sorted) // 2] if gaps_sorted else 0
    threshold = typical * 2.5
    chains, cur = [], [order[0]]
    for i in range(1, len(order)):
        if gaps[i - 1] > threshold:
            chains.append(cur); cur = []
        cur.append(order[i])
    chains.append(cur)
    return chains, typical


def extract_block(pdf_path, xlsx_path, block, out_dir):
    page, pdf_tr, drawings = load_pdf_trackers(pdf_path, block)
    xl = load_excel_strings(xlsx_path, block)

    # merge: one entry per tracker number
    trackers = {}
    for tnum, rows in pdf_tr.items():
        cxs = [r['cx'] for r in rows.values()]
        cys = [r['cy'] for r in rows.values()]
        trackers[tnum] = {
            'rows': sorted(rows.keys()),
            'cx': sum(cxs) / len(cxs),
            'cy': sum(cys) / len(cys),
            'row_pos': {r: (v['cx'], v['cy']) for r, v in rows.items()},
            'type': next(iter(rows.values()))['type'],
            'short': any(v['len'] == 'S' for v in rows.values()),
        }

    # road + side
    roads = road_polygons(drawings)
    txs = [t['cx'] for t in trackers.values()]; tys = [t['cy'] for t in trackers.values()]
    tbox = fitz.Rect(min(txs), min(tys), max(txs), max(tys))
    tcx, tcy = (tbox.x0 + tbox.x1) / 2, (tbox.y0 + tbox.y1) / 2
    # Road choice (learned on blocks 7 / 14 / 45): the biggest or nearest grey polygon is often a
    # boundary road along an edge. The road that matters is the one that actually SPLITS the
    # trackers, so score each nearby candidate by the size of the smaller side it produces and
    # keep the best. Score 0 everywhere = no internal road (block 45): all trackers one side.
    near = fitz.Rect(tbox.x0 - 150, tbox.y0 - 150, tbox.x1 + 150, tbox.y1 + 150)
    best = None
    for rd in roads:
        if not rd[2].intersects(near):
            continue
        ln = fit_line(rd[1])
        a = sum(1 for t in trackers.values() if side_of(ln, t['cx'], t['cy']) > 0)
        score = min(a, len(trackers) - a)
        if best is None or score > best[0]:
            best = (score, rd, ln)
    road, line = (best[1], best[2]) if best and best[0] > 0 else (None, None)

    # Side + axis. Road left-right -> North (smaller y) / South, axis 'y'. Road up-down -> the
    # two halves are West / East; the app's type only knows North/South, so West is stored as
    # 'North' and East as 'South' (roadOrientation in the JSON says which case this is).
    axis = 'y'; road_orientation = 'none'
    if line:
        a, b, c = line
        horizontal_road = abs(b) >= abs(a)
        axis = 'y' if horizontal_road else 'x'
        road_orientation = 'horizontal' if horizontal_road else 'vertical'
        # Roads are curved bands, not lines (block 47): test each tracker against the road's
        # LOCAL centre at that tracker's x (or y for a vertical road), using the polygon's own
        # points, then let each chain (= one physical row) vote -- a road never splits a row.
        pts = road[1]
        def local_centre(v, horizontal):
            idx = 0 if horizontal else 1
            near_pts = [q for q in pts if abs(q[idx] - v) < 60]
            if not near_pts:
                near_pts = sorted(pts, key=lambda q: abs(q[idx] - v))[:4]
            other = 1 - idx
            return sum(q[other] for q in near_pts) / len(near_pts)
        for t in trackers.values():
            if horizontal_road:
                t['side'] = 'North' if t['cy'] < local_centre(t['cx'], True) else 'South'
            else:
                t['side'] = 'North' if t['cx'] < local_centre(t['cy'], False) else 'South'
    else:
        # no internal road: rows run whichever way; all trackers count as one side
        spread_x = tbox.x1 - tbox.x0; spread_y = tbox.y1 - tbox.y0
        axis = 'y' if spread_x >= spread_y else 'x'
        for t in trackers.values():
            t['side'] = 'South'

    # chains -> pos / pos_total
    chains, typical = build_chains(trackers)
    for chain in chains:
        north_votes = sum(1 for tn in chain if trackers[tn]['side'] == 'North')
        chain_side = 'North' if north_votes * 2 > len(chain) else 'South'
        for i, tnum in enumerate(chain):
            trackers[tnum]['pos'] = i + 1
            trackers[tnum]['pos_total'] = len(chain)
            trackers[tnum]['side'] = chain_side

    # dc boxes: centroid of member trackers
    dcb_members = defaultdict(list)
    for (tnum, row), meta in xl.items():
        if tnum in trackers and meta['dcb']:
            dcb_members[meta['dcb']].append(trackers[tnum])
            trackers[tnum]['dcbox'] = meta['dcb']
    dcbox = [{'name': name, 'x': sum(t['cx'] for t in m) / len(m), 'y': sum(t['cy'] for t in m) / len(m)} for name, m in dcb_members.items()]

    # strings: per tracker-row, the two strings from the Excel, placed at the row label position
    strings = []
    for (tnum, row), meta in xl.items():
        if tnum not in trackers or row not in trackers[tnum]['row_pos']:
            continue
        cx, cy = trackers[tnum]['row_pos'][row]
        for s in meta['strings']:
            bar_len = BAR_LEN_SHORT if trackers[tnum]['short'] else BAR_LEN_LONG
            strings.append({'n': s, 'x': cx, 'y': cy, 'w': bar_len, 'h': 10.0, 's': trackers[tnum]['side'], 't': tnum, 'r': row})

    # image: crop the layout area to the tracker bounding box + margin
    xs = [t['cx'] for t in trackers.values()]; ys = [t['cy'] for t in trackers.values()]
    margin = 120
    clip = fitz.Rect(max(0, min(xs) - margin), max(0, min(ys) - margin), min(LAYOUT_X_MAX, max(xs) + margin), max(ys) + margin)
    scale = 2.0
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip)
    os.makedirs(os.path.join(out_dir, 'images'), exist_ok=True)
    bb = f'{block:02d}'
    pix.save(os.path.join(out_dir, 'images', f'{bb}.png'))

    # shift everything into image coordinates
    def tx(x): return (x - clip.x0) * scale
    def ty(y): return (y - clip.y0) * scale
    geo = {
        'block': block,
        'w': pix.width,
        'h': pix.height,
        'road': ty((road[2].y0 + road[2].y1) / 2) if (road and road_orientation == 'horizontal') else (tx((road[2].x0 + road[2].x1) / 2) if road else 0),
        'axis': axis,
        'roadOrientation': road_orientation,
        'trackers': {},
        'dcbox': [{'name': d['name'], 'x': tx(d['x']), 'y': ty(d['y'])} for d in dcbox],
        'strings': [dict(s, x=tx(s['x']), y=ty(s['y']), w=s['w'] * scale, h=s['h'] * scale) for s in strings],
    }
    for tnum, t in trackers.items():
        geo['trackers'][f'{bb}-{tnum}'] = {
            'rows': t['rows'], 'cx': tx(t['cx']), 'cy': ty(t['cy']),
            'dcbox': t.get('dcbox'), 'side': t['side'], 'pos': t['pos'], 'pos_total': t['pos_total'],
            'short': t['short'],
        }
    with open(os.path.join(out_dir, f'{bb}.json'), 'w') as f:
        json.dump(geo, f)

    unmatched_xl = [k for k in xl if k[0] not in trackers]
    unmatched_pdf = [(tn, r) for tn, rows in pdf_tr.items() for r in rows if (tn, r) not in xl]
    return {
        'block': block, 'trackers': len(trackers), 'strings': len(strings), 'dcbox': len(dcbox),
        'chains': [len(c) for c in chains], 'typical_gap': round(typical, 1),
        'north': sum(1 for t in trackers.values() if t['side'] == 'North'),
        'bars_found': sum(1 for rows in pdf_tr.values() for v in rows.values() if v['bar_found']),
        'bars_total': sum(len(rows) for rows in pdf_tr.values()),
        'short': sum(1 for t in trackers.values() if t['short']), 'axis': axis, 'road': road_orientation,
        'unmatched_excel': unmatched_xl, 'unmatched_pdf': unmatched_pdf,
        'image': (pix.width, pix.height),
    }


if __name__ == '__main__':
    pdf, xlsx, block, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
    print(json.dumps(extract_block(pdf, xlsx, block, out), indent=1))
