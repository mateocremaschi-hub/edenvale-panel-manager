import json, sys
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt, matplotlib.image as mpimg
def overlay(block, out_png, dpi=60):
    g = json.load(open(f'out/{block:02d}.json'))
    img = mpimg.imread(f'out/images/{block:02d}.png')
    fig, ax = plt.subplots(figsize=(14, 14 * g['h'] / g['w']))
    ax.imshow(img)
    for k, t in g['trackers'].items():
        ax.scatter(t['cx'], t['cy'], s=18, facecolor='yellow' if not t.get('short') else 'cyan',
                   edgecolor='blue' if t['side'] == 'North' else 'red', linewidth=1.2, zorder=3)
        if t['pos'] in (1, t['pos_total']):
            ax.annotate(f"{k[3:]} p{t['pos']}/{t['pos_total']}", (t['cx'], t['cy']), fontsize=5, xytext=(3, 3),
                        textcoords='offset points', bbox=dict(boxstyle='round,pad=0.1', fc='white', alpha=0.85, lw=0), zorder=4)
    for d in g['dcbox']:
        ax.scatter(d['x'], d['y'], s=60, marker='s', facecolor='none', edgecolor='green', linewidth=1.2, zorder=3)
    if g['axis'] == 'y': ax.axhline(g['road'], color='magenta', ls='--', lw=1, alpha=0.6)
    ax.set_title(f"Bloque {block} axis={g['axis']} -- amarillo=largo cyan=corto | borde azul=N rojo=S | verde=DC")
    ax.axis('off'); plt.savefig(out_png, dpi=dpi, bbox_inches='tight'); plt.close()
if __name__ == '__main__':
    for b in sys.argv[1:]:
        overlay(int(b), f'/tmp/ov_{int(b):02d}.png'); print('ok', b)
