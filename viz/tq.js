"use strict";
// Shared math and drawing helpers for the TurboQuant visualizations (tq-*.html).
const TQ = (() => {

// ===== random numbers (seeded, so a page can redraw the same sample) =======
function rng(seed){                       // mulberry32
  let a = seed >>> 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const newSeed = () => (Math.random() * 2**32) >>> 0;
function gauss(r){ let u; do u = r(); while (u === 0); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }
const gaussVec = (r, d) => Array.from({length: d}, () => gauss(r));

// ===== vectors as plain arrays ============================================
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const norm = a => Math.sqrt(dot(a, a));
const scale = (a, c) => a.map(v => v * c);
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const unit = a => scale(a, 1 / norm(a));
const unitVec = (r, d) => unit(gaussVec(r, d));      // uniform on the sphere
const matVec = (M, v) => M.map(row => dot(row, v));  // M v
function matTVec(M, v){                              // M^T v
  const out = new Array(M[0].length).fill(0);
  M.forEach((row, i) => { for (let j = 0; j < row.length; j++) out[j] += row[j] * v[i]; });
  return out;
}
// Haar-random rotation: Gram-Schmidt (done twice, for stability) on rows of a Gaussian matrix
function rotation(d, r){
  const Q = [];
  for (let i = 0; i < d; i++){
    const v = gaussVec(r, d);
    for (let pass = 0; pass < 2; pass++)
      for (const q of Q){ const c = dot(v, q); for (let j = 0; j < d; j++) v[j] -= c * q[j]; }
    Q.push(unit(v));
  }
  return Q;
}
const gaussMatrix = (m, d, r) => Array.from({length: m}, () => gaussVec(r, d));
const sign = v => v >= 0 ? 1 : -1;

// ===== the coordinate distribution after a random rotation ==================
function lgamma(x){                         // Lanczos approximation
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1; let a = c[0]; const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
// density of one coordinate of a uniform unit vector in R^d:
//   f(t) = Γ(d/2) / (√π Γ((d-1)/2)) · (1 - t²)^((d-3)/2),  i.e. (t+1)/2 ~ Beta((d-1)/2, (d-1)/2)
function coordDensity(d){
  const lc = lgamma(d / 2) - 0.5 * Math.log(Math.PI) - lgamma((d - 1) / 2);
  return t => Math.abs(t) >= 1 ? 0 : Math.exp(lc + (d - 3) / 2 * Math.log(1 - t * t));
}
const gaussDensity = s => t => Math.exp(-t * t / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI));

// ===== Lloyd-Max = 1-d J-means on weighted points ===========================
// xs must be sorted; ws are nonnegative weights (all 1 for samples, f(x)dx for a density)
function densityGrid(f, a, b, n = 4000){
  const dx = (b - a) / n, xs = [], ws = [];
  for (let i = 0; i < n; i++){ const x = a + (i + .5) * dx; xs.push(x); ws.push(f(x) * dx); }
  const tot = ws.reduce((s, w) => s + w, 0);
  return {xs, ws: ws.map(w => w / tot)};
}
const boundaries = c => c.slice(1).map((v, i) => (c[i] + v) / 2);
function cellIndex(v, bnds){ let k = 0; while (k < bnds.length && v > bnds[k]) k++; return k; }
// per-cell weight, weighted sum, and weighted squared error for the cells of `bnds`, scored against centroids c
function cellStats({xs, ws}, bnds, c){
  const J = bnds.length + 1, w = new Array(J).fill(0), sx = new Array(J).fill(0), se = new Array(J).fill(0);
  let k = 0;
  for (let i = 0; i < xs.length; i++){
    while (k < J - 1 && xs[i] > bnds[k]) k++;
    w[k] += ws[i]; sx[k] += ws[i] * xs[i]; se[k] += ws[i] * (xs[i] - c[k]) ** 2;
  }
  const tot = w.reduce((s, v) => s + v, 0);
  return {w, sx, se, tot, mse: se.reduce((s, v) => s + v, 0) / tot};
}
// update step: move each centroid to the (weighted) mean of its cell; empty cells keep their centroid
function lloydUpdate(pts, c, bnds = boundaries(c)){
  const {w, sx} = cellStats(pts, bnds, c);
  return c.map((v, j) => w[j] > 0 ? sx[j] / w[j] : v);
}
const quantMSE = (pts, c) => cellStats(pts, boundaries(c), c).mse;
// J centroids at the (j+½)/J quantiles: a good, deterministic starting point
function quantileInit({xs, ws}, J){
  const tot = ws.reduce((s, w) => s + w, 0), out = []; let acc = 0, j = 0;
  for (let i = 0; i < xs.length && j < J; i++){
    acc += ws[i];
    while (j < J && acc >= (j + .5) / J * tot){ out.push(xs[i]); j++; }
  }
  while (out.length < J) out.push(xs[xs.length - 1]);
  return out;
}
function lloydMax(pts, c, maxIter = 3000, tol = 1e-10){
  for (let it = 0; it < maxIter; it++){
    const n = lloydUpdate(pts, c);
    const moved = Math.max(...n.map((v, j) => Math.abs(v - c[j])));
    c = n; if (moved < tol) break;
  }
  return c;
}
// optimal b-bit codebook for one coordinate of a rotated unit vector in R^d (cached)
const cbCache = new Map();
function codebook(d, bits){
  const key = d + ':' + bits;
  if (!cbCache.has(key)){
    const R = Math.min(1, 12 / Math.sqrt(d)), pts = densityGrid(coordDensity(d), -R, R, 6000);
    const c = lloydMax(pts, quantileInit(pts, 2 ** bits));
    cbCache.set(key, {c, b: boundaries(c), mse: quantMSE(pts, c)});
  }
  return cbCache.get(key);
}

// ===== histograms ==========================================================
function hist(vals, a, b, nb){
  const counts = new Array(nb).fill(0), w = (b - a) / nb; let under = 0, over = 0;
  for (const v of vals){
    if (v < a) under++; else if (v >= b) over++; else counts[Math.min(nb - 1, Math.floor((v - a) / w))]++;
  }
  const n = vals.length || 1;
  return {a, b, nb, w, counts, under, over, n: vals.length, dens: counts.map(c => c / (n * w))};
}
function corr(xs, ys){
  const n = xs.length, mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++){ const a = xs[i] - mx, b = ys[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxy / Math.sqrt(sxx * syy || 1);
}
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const variance = a => { const m = mean(a); return a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length; };

// ===== formatting ==========================================================
const fmt = (v, p = 3) => (Math.abs(v) < 0.5 * 10 ** -p ? 0 : v).toFixed(p).replace('-', '−');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ===== SVG charts ==========================================================
// "Nice" tick values covering [a, b]
function ticks(a, b, n = 5){
  const step0 = (b - a) / n, mag = 10 ** Math.floor(Math.log10(step0)), e = step0 / mag;
  const step = mag * (e >= 7.5 ? 10 : e >= 3.5 ? 5 : e >= 1.5 ? 2 : 1), out = [];
  for (let v = Math.ceil(a / step - 1e-9) * step; v <= b + step * 1e-9; v += step) out.push(+v.toFixed(12));
  return out;
}
const tickFmt = v => (+v.toPrecision(4)).toString().replace('-', '−');
// A plot frame. Returns scales X, Y and helpers that each return an SVG string.
function chart({w = 520, h = 240, m = {l: 44, r: 12, t: 10, b: 30}, x, y, xticks, yticks,
                xlabel = '', ylabel = '', xfmt = tickFmt, yfmt = tickFmt, grid = true}){
  const X = v => m.l + (v - x[0]) / (x[1] - x[0]) * (w - m.l - m.r);
  const Y = v => h - m.b - (v - y[0]) / (y[1] - y[0]) * (h - m.t - m.b);
  const xt = xticks || ticks(x[0], x[1], Math.max(2, Math.round((w - m.l - m.r) / 80)));
  const yt = yticks || ticks(y[0], y[1], Math.max(2, Math.round((h - m.t - m.b) / 45)));
  const f = {w, h, m, X, Y, x, y};
  f.axes = () =>
    (grid ? yt.map(v => `<line class="grid" x1="${m.l}" x2="${w - m.r}" y1="${Y(v)}" y2="${Y(v)}"/>`).join('') : '') +
    `<line class="axis" x1="${m.l}" x2="${w - m.r}" y1="${h - m.b}" y2="${h - m.b}"/>` +
    `<line class="axis" x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${h - m.b}"/>` +
    xt.map(v => `<text x="${X(v)}" y="${h - m.b + 14}" text-anchor="middle">${xfmt(v)}</text>`).join('') +
    yt.map(v => `<text x="${m.l - 5}" y="${Y(v) + 4}" text-anchor="end">${yfmt(v)}</text>`).join('') +
    (xlabel ? `<text class="lab" x="${(m.l + w - m.r) / 2}" y="${h - 2}" text-anchor="middle">${xlabel}</text>` : '') +
    (ylabel ? `<text class="lab" transform="translate(11 ${(m.t + h - m.b) / 2}) rotate(-90)" text-anchor="middle">${ylabel}</text>` : '');
  const clampY = v => Math.max(m.t, Math.min(h - m.b, Y(v)));
  f.line = (pts, style) => pts.length < 2 ? '' :
    `<path fill="none" style="${style}" d="M${pts.map(([a, b]) => `${X(a).toFixed(1)},${clampY(b).toFixed(1)}`).join('L')}"/>`;
  f.fn = (g, style, a = x[0], b = x[1], n = 300) =>
    f.line(Array.from({length: n + 1}, (_, i) => { const t = a + (b - a) * i / n; return [t, g(t)]; }), style);
  f.vline = (v, style, label = '') => `<line style="${style}" x1="${X(v)}" x2="${X(v)}" y1="${m.t}" y2="${h - m.b}"/>` +
    (label ? `<text class="lab" x="${X(v) + 3}" y="${m.t + 10}">${label}</text>` : '');
  f.hline = (v, style) => `<line style="${style}" x1="${m.l}" x2="${w - m.r}" y1="${Y(v)}" y2="${Y(v)}"/>`;
  // histogram drawn as density bars (gap of 1px between bars)
  f.hist = (H, style, tip = '') => H.dens.map((dv, i) => {
    const x0 = X(H.a + i * H.w), x1 = X(H.a + (i + 1) * H.w), top = clampY(dv);
    return dv > 0 ? `<rect style="${style}" x="${x0 + .5}" y="${top}" width="${Math.max(.5, x1 - x0 - 1)}" height="${h - m.b - top}">` +
      `<title>${tip}[${fmt(H.a + i * H.w)}, ${fmt(H.a + (i + 1) * H.w)}): ${H.counts[i]}</title></rect>` : '';
  }).join('');
  // histogram outline only (for overlaying several)
  f.histStep = (H, style) => {
    const pts = []; let x0 = H.a;
    H.dens.forEach((dv, i) => { pts.push([x0, dv], [x0 + H.w, dv]); x0 += H.w; });
    return f.line([[H.a, 0], ...pts, [H.b, 0]], style);
  };
  return f;
}
const svgOut = (el, f, body) => { el.setAttribute('viewBox', `0 0 ${f.w} ${f.h}`); el.innerHTML = body; };

// Bar chart of a vector's coordinates; series[0] as bars, later series as short ticks.
function vecChart(el, series, {w = 520, h = 190, ymax, levels = [], labels = null, ylabel = ''} = {}){
  const d = series[0].v.length;
  ymax = ymax || Math.max(...series.flatMap(s => s.v.map(Math.abs))) * 1.08 || 1;
  const f = chart({w, h, m: {l: 44, r: 8, t: 8, b: labels ? 30 : 18}, x: [0, d], y: [-ymax, ymax], ylabel,
                   xticks: [], grid: false});
  const bw = (f.X(1) - f.X(0));
  let s = f.axes() + `<line class="zero" x1="${f.m.l}" x2="${w - f.m.r}" y1="${f.Y(0)}" y2="${f.Y(0)}"/>`;
  s += levels.map(v => f.hline(v, 'stroke:var(--ink-faint);stroke-dasharray:3 3;stroke-width:1')).join('');
  series.forEach((ser, k) => ser.v.forEach((v, i) => {
    const x0 = f.X(i), tip = `<title>${ser.name || ''} [${i}] = ${fmt(v)}</title>`;
    if (k === 0){
      const y0 = f.Y(Math.max(v, 0)), y1 = f.Y(Math.min(v, 0));
      s += `<rect style="fill:${ser.color};opacity:${ser.opacity || .85}" x="${x0 + Math.min(1, bw * .1)}" y="${y0}" width="${Math.max(.6, bw - Math.min(2, bw * .2))}" height="${Math.max(.5, y1 - y0)}">${tip}</rect>`;
    } else
      s += `<line style="stroke:${ser.color};stroke-width:${Math.max(2, Math.min(3, bw * .15))}" x1="${x0 + bw * .1}" x2="${x0 + bw * .9}" y1="${f.Y(v)}" y2="${f.Y(v)}">${tip}</line>`;
  }));
  if (labels) s += labels.map((t, i) => `<text x="${f.X(i + .5)}" y="${h - f.m.b + 13}" text-anchor="middle" style="font:10px var(--mono);fill:var(--ink-soft)">${t}</text>`).join('');
  svgOut(el, f, s);
}

// ===== interactive 2-D plane for the SimHash and QJL pages =================
// Draggable vectors x and y, plus random rows s_i of S drawn as hyperplanes (lines ⟂ s_i).
// The latest hyperplane is bold, with x's side shaded. `under(c)` lets a page add SVG beneath
// the hyperplanes, and `arrows()` extra arrows on top. onDrag() is called while dragging.
const subDigits = n => String(n).split('').map(ch => '₀₁₂₃₄₅₆₇₈₉'[ch]).join('');
function plane(el, {onDrag, under = () => '', arrows = () => []}){
  const L = 1.7, far = 3 * L, MAXLEN = 1.5;
  const c = chart({w: 420, h: 420, m: {l: 10, r: 10, t: 10, b: 10}, x: [-L, L], y: [-L, L], xticks: [], yticks: [], grid: false});
  const key = col => col.replace(/\W/g, '');
  const arrow = (v, col, w = 2.5, dash = '') =>
    `<line x1="${c.X(0)}" y1="${c.Y(0)}" x2="${c.X(v[0])}" y2="${c.Y(v[1])}" style="stroke:${col};stroke-width:${w};${dash ? 'stroke-dasharray:' + dash : ''}" marker-end="url(#ah-${key(col)})"/>`;
  const marker = col => `<marker id="ah-${key(col)}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0L10,5L0,10z" style="fill:${col}"/></marker>`;
  const line = (p, style) => `<line x1="${c.X(far * p[0])}" y1="${c.Y(far * p[1])}" x2="${c.X(-far * p[0])}" y2="${c.Y(-far * p[1])}" style="${style}"/>`;
  const P = {X: [0.95, 0.35], Y: [0.3, 0.9], S: [], c};
  P.draw = () => {
    const {X, Y, S} = P, extra = arrows();
    const cols = [...new Set(['var(--mem)', 'var(--third)', 'var(--ink-soft)', ...extra.map(a => a.col)])];
    let s = `<defs>${cols.map(marker).join('')}<clipPath id="pclip"><rect x="${c.X(-L)}" y="${c.Y(L)}" width="${c.X(L) - c.X(-L)}" height="${c.Y(-L) - c.Y(L)}"/></clipPath></defs>`;
    s += `<line class="axis" x1="${c.X(-L)}" x2="${c.X(L)}" y1="${c.Y(0)}" y2="${c.Y(0)}"/><line class="axis" x1="${c.X(0)}" x2="${c.X(0)}" y1="${c.Y(-L)}" y2="${c.Y(L)}"/>`;
    s += `<circle cx="${c.X(0)}" cy="${c.Y(0)}" r="${c.X(1) - c.X(0)}" style="fill:none;stroke:var(--line);stroke-dasharray:3 3"/>`;
    s += '<g clip-path="url(#pclip)">' + under(c);
    S.slice(-40, -1).forEach(v => s += line(unit([-v[1], v[0]]), 'stroke:var(--ink-faint);stroke-width:1;opacity:.25'));
    if (S.length){
      const v = S[S.length - 1], n = norm(v), p = [-v[1] / n, v[0] / n], g = sign(dot(v, X)), u = [g * v[0] / n, g * v[1] / n];
      const poly = [[p[0], p[1]], [p[0] + u[0], p[1] + u[1]], [-p[0] + u[0], -p[1] + u[1]], [-p[0], -p[1]]];
      s += `<polygon points="${poly.map(([a, b]) => `${c.X(far * a)},${c.Y(far * b)}`).join(' ')}" style="fill:var(--mem-soft);opacity:.55"/>` +
        line(p, 'stroke:var(--ink-soft);stroke-width:1.5');
      const tip = scale(v, Math.min(1, MAXLEN / n));
      s += arrow(tip, 'var(--ink-soft)', 1.5, '4 3') + `<text class="lab" x="${c.X(tip[0]) + 6}" y="${c.Y(tip[1])}">s${subDigits(S.length)}</text>`;
    }
    s += '</g>';
    s += extra.map(a => arrow(a.v, a.col, a.w || 3)).join('') + arrow(Y, 'var(--third)') + arrow(X, 'var(--mem)');
    for (const [v, col, name] of [[X, 'var(--mem)', 'x'], [Y, 'var(--third)', 'y']])
      s += `<circle class="handle" data-h="${name}" cx="${c.X(v[0])}" cy="${c.Y(v[1])}" r="9" style="fill:${col};opacity:.35;cursor:grab"/>` +
           `<text x="${c.X(v[0]) + 10}" y="${c.Y(v[1]) - 8}" style="font:600 14px var(--sans);fill:${col}">${name}</text>`;
    svgOut(el, c, s);
  };
  // dragging x and y (lengths kept between 0.1 and 1.5)
  let drag = null;
  const toPlane = e => {
    const b = el.getBoundingClientRect(), k = c.w / b.width, px = (e.clientX - b.left) * k, py = (e.clientY - b.top) * k;
    const v = [c.x[0] + (px - c.m.l) / (c.w - c.m.l - c.m.r) * (c.x[1] - c.x[0]),
               c.y[0] + (c.h - c.m.b - py) / (c.h - c.m.t - c.m.b) * (c.y[1] - c.y[0])];
    const n = norm(v); return n > MAXLEN ? scale(v, MAXLEN / n) : n < .1 ? scale(v, .1 / (n || 1)) : v;
  };
  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', e => {
    const h = e.target.closest('[data-h]'); if (!h) return;
    drag = h.dataset.h; el.setPointerCapture(e.pointerId); e.preventDefault();
  });
  el.addEventListener('pointermove', e => { if (drag){ P[drag === 'x' ? 'X' : 'Y'] = toPlane(e); onDrag(); } });
  el.addEventListener('pointerup', () => drag = null);
  return P;
}

// ===== navigation between the pages ===================================
const PAGES = [
  ['tq-rotation.html',  '1 · Random rotation'],
  ['tq-lloyd-max.html', '2 · Lloyd–Max quantizer'],
  ['tq-simhash.html',   '3 · SimHash review'],
  ['tq-qjl.html',       '4 · QJL'],
  ['tq-pipeline.html',  '5 · TurboQuant end to end'],
];
function nav(){
  const here = location.pathname.split('/').pop() || PAGES[0][0];
  const i = PAGES.findIndex(p => p[0] === here);
  const el = document.querySelector('nav.tq');
  if (el) el.innerHTML = '<span class="lbl">TurboQuant</span>' +
    PAGES.map(([href, t]) => `<a href="${href}" class="${href === here ? 'here' : ''}">${t}</a>`).join('') +
    '<a class="home" href="index.html">All visualizations</a>';
  const nx = document.getElementById('nextpage');
  if (nx && i >= 0) nx.innerHTML = i + 1 < PAGES.length
    ? `Next: <a href="${PAGES[i + 1][0]}">${PAGES[i + 1][1]}</a>`
    : `Back to the start: <a href="${PAGES[0][0]}">${PAGES[0][1]}</a>`;
}
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', nav);

return {rng, newSeed, gauss, gaussVec, dot, norm, scale, add, sub, unit, unitVec, matVec, matTVec,
        rotation, gaussMatrix, sign, lgamma, coordDensity, gaussDensity, densityGrid, boundaries,
        cellIndex, cellStats, lloydUpdate, quantMSE, quantileInit, lloydMax, codebook, hist, corr,
        mean, variance, fmt, esc, ticks, chart, svgOut, vecChart, plane, subDigits, PAGES};
})();
if (typeof module !== 'undefined') module.exports = TQ;
