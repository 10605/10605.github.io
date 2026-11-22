"use strict";
// Shared math and drawing helpers for the prediction-powered inference visualizations (ppi-*.html).
const PPI = (() => {

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
// Gamma(a, 1) by Marsaglia and Tsang
function gamma(r, a){
  if (a < 1){ let u; do u = r(); while (u === 0); return gamma(r, 1 + a) * Math.pow(u, 1 / a); }
  const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;){
    let x, v;
    do { x = gauss(r); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = r();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
const beta = (r, a, b) => { const x = gamma(r, a), y = gamma(r, b); return x / (x + y); };
const studentT = (r, nu) => gauss(r) / Math.sqrt(2 * gamma(r, nu / 2) / nu);

// ===== densities and the incomplete beta function ============================
function lgamma(x){                         // Lanczos approximation
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1; let a = c[0]; const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
const betaPdf = (a, b) => {
  const lc = lgamma(a + b) - lgamma(a) - lgamma(b);
  return x => x <= 0 || x >= 1 ? 0 : Math.exp(lc + (a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x));
};
// density of m + s·T, with T Student-t on nu degrees of freedom (nu = Infinity gives a Gaussian)
const locScalePdf = (m, s, nu = Infinity) => {
  if (nu === Infinity) return x => Math.exp(-(((x - m) / s) ** 2) / 2) / (s * Math.sqrt(2 * Math.PI));
  const lc = lgamma((nu + 1) / 2) - lgamma(nu / 2) - 0.5 * Math.log(nu * Math.PI);
  return x => Math.exp(lc - (nu + 1) / 2 * Math.log(1 + ((x - m) / s) ** 2 / nu)) / s;
};
// regularized incomplete beta I_x(a, b), by the continued fraction in Numerical Recipes
function betacf(a, b, x){
  const FPMIN = 1e-300, qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d; let h = d;
  for (let m = 1; m <= 400; m++){
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < 3e-14) break;
  }
  return h;
}
function betaInc(x, a, b){
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
function betaInv(p, a, b){                   // by bisection
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++){ const mid = (lo + hi) / 2; if (betaInc(mid, a, b) < p) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
// the classical ("exact") binomial interval for k successes in n trials, at level 1 − alpha
function clopperPearson(k, n, alpha){
  return [k === 0 ? 0 : betaInv(alpha / 2, k, n - k + 1), k === n ? 1 : betaInv(1 - alpha / 2, k + 1, n - k)];
}

// ===== the synthetic data: human label H and autorater label A =============
// P(H=1) = p; the autorater flips a true 0 to 1 with probability fp, and a true 1 to 0 with probability fn
const pA = ({p, fp, fn}) => p * (1 - fn) + (1 - p) * fp;
// From uniforms uh, ua (so moving a slider re-thresholds the same draws instead of making new ones)
const label = (uh, ua, {p, fp, fn}) => { const h = uh < p ? 1 : 0; return [h, h ? (ua >= fn ? 1 : 0) : (ua < fp ? 1 : 0)]; };

// Sufficient statistics of a labeled sample S_n of (h, a) pairs and an unlabeled sample S_N of a's
//   counts[h][a]: confusion counts in S_n;  m: number of A=1 in S_N
function summarize(counts, N, m){
  const n = counts[0][0] + counts[0][1] + counts[1][0] + counts[1][1];
  const k = counts[1][0] + counts[1][1], ka = counts[0][1] + counts[1][1];
  return {n, N, m, k, ka, counts};
}
// The rectifier d = h − λa over S_n: its mean and sample standard deviation
function rectifier(S, lambda = 1){
  const {n, counts} = S;
  let s1 = 0, s2 = 0;
  for (const h of [0, 1]) for (const a of [0, 1]){ const d = h - lambda * a, c = counts[h][a]; s1 += c * d; s2 += c * d * d; }
  const mean = s1 / n, sd = n > 1 ? Math.sqrt(Math.max(0, (s2 - n * mean * mean) / (n - 1))) : 0;
  return {mean, sd, se: sd / Math.sqrt(n)};
}
// Power tuning (PPI++): λ = Cov(h, a) / ((1 + n/N) Var(a)), clipped to [0, 1];
// Cov from S_n, Var(a) from all the autorater labels
function powerTune(S){
  const {n, N, m, k, ka, counts} = S;
  const cov = (counts[1][1] - k * ka / n) / (n - 1);
  const qa = (ka + m) / (n + N), va = qa * (1 - qa);
  return va > 0 ? Math.max(0, Math.min(1, cov / ((1 + n / N) * va))) : 0;
}
// Posteriors of the two means in g = λ μ1 + μ2 (Eq 1, or Eq 5 with λ < 1):
//   μ1 = mean autorater label on S_N: Beta(m + ½, N − m + ½) (Jeffreys prior), scaled by λ
//   μ2 = mean rectifier h − λa on S_n: Gaussian with sd = standard error (Student-t if n < 30)
function posteriors(S, lambda = 1){
  const R = rectifier(S, lambda), nu = S.n < 30 ? S.n - 1 : Infinity;
  const a1 = S.m + .5, b1 = S.N - S.m + .5;
  return {lambda, a1, b1, rect: R, nu,
          mu1Pdf: x => betaPdf(a1, b1)(x / lambda) / lambda,
          mu2Pdf: locScalePdf(R.mean, Math.max(R.se, 1e-9), nu),
          draw1: r => lambda * beta(r, a1, b1),
          draw2: r => R.mean + R.se * (nu === Infinity ? gauss(r) : studentT(r, nu))};
}
// Monte Carlo integration: T draws of (s1, s2) and g = s1 + s2, plus the equal-tailed interval
function monteCarlo(post, T, r){
  const s1 = new Float64Array(T), s2 = new Float64Array(T), g = new Float64Array(T);
  for (let t = 0; t < T; t++){ s1[t] = post.draw1(r); s2[t] = post.draw2(r); g[t] = s1[t] + s2[t]; }
  return {s1, s2, g};
}
// t_lo = ⌊(α/2)T⌋ and t_hi = ⌈(1 − α/2)T⌉ in the sorted sample (1-based, as in the paper)
function mcInterval(g, alpha, T = g.length){
  const sorted = Float64Array.from(g.subarray ? g.subarray(0, T) : g.slice(0, T)).sort();
  return [sorted[Math.max(0, Math.floor(alpha / 2 * T) - 1)], sorted[Math.min(T - 1, Math.ceil((1 - alpha / 2) * T) - 1)]];
}

// ===== formatting ==========================================================
const fmt = (v, p = 3) => (Math.abs(v) < 0.5 * 10 ** -p ? 0 : v).toFixed(p).replace('-', '−');
const pct = v => `${Math.round(100 * v)}%`;

// ===== SVG charts ==========================================================
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
  f.clampY = clampY;
  f.line = (pts, style) => pts.length < 2 ? '' :
    `<path fill="none" style="${style}" d="M${pts.map(([a, b]) => `${X(a).toFixed(1)},${clampY(b).toFixed(1)}`).join('L')}"/>`;
  f.fn = (g, style, a = x[0], b = x[1], n = 400) =>
    f.line(Array.from({length: n + 1}, (_, i) => { const t = a + (b - a) * i / n; return [t, g(t)]; }), style);
  f.vline = (v, style, label = '') => `<line style="${style}" x1="${X(v)}" x2="${X(v)}" y1="${m.t}" y2="${h - m.b}"/>` +
    (label ? `<text class="lab" x="${X(v) + 3}" y="${m.t + 10}">${label}</text>` : '');
  f.hline = (v, style) => `<line style="${style}" x1="${m.l}" x2="${w - m.r}" y1="${Y(v)}" y2="${Y(v)}"/>`;
  f.dots = (pts, style, r = 3.5) => pts.map(([a, b]) => `<circle cx="${X(a)}" cy="${Y(b)}" r="${r}" style="${style}"/>`).join('');
  // histogram as density bars; color(i, lo, hi) picks each bar's style
  f.hist = (H, color) => H.dens.map((dv, i) => {
    const x0 = X(H.a + i * H.w), x1 = X(H.a + (i + 1) * H.w), top = clampY(dv);
    return dv > 0 ? `<rect style="${color(H.a + i * H.w, H.a + (i + 1) * H.w)}" x="${x0}" y="${top}" width="${Math.max(.5, x1 - x0 - .6)}" height="${h - m.b - top}"/>` : '';
  }).join('');
  return f;
}
function hist(vals, a, b, nb, T = vals.length){
  const counts = new Array(nb).fill(0), w = (b - a) / nb;
  for (let i = 0; i < T; i++){ const v = vals[i]; if (v >= a && v < b) counts[Math.min(nb - 1, Math.floor((v - a) / w))]++; }
  return {a, b, nb, w, counts, dens: counts.map(c => c / ((T || 1) * w))};
}
const svgOut = (el, f, body) => { el.setAttribute('viewBox', `0 0 ${f.w} ${f.h}`); el.innerHTML = body; };

// ===== navigation between the pages ===================================
const PAGES = [
  ['ppi-intro.html',  '1 · PPI and Monte Carlo intervals'],
  ['ppi-curves.html', '2 · Classical vs PPI vs PPI++'],
];
function nav(){
  const here = location.pathname.split('/').pop() || PAGES[0][0];
  const i = PAGES.findIndex(p => p[0] === here);
  const el = document.querySelector('nav.series');
  if (el) el.innerHTML = '<span class="lbl">Bayesian PPI</span>' +
    PAGES.map(([href, t]) => `<a href="${href}" class="${href === here ? 'here' : ''}">${t}</a>`).join('') +
    '<a class="home" href="index.html">All visualizations</a>';
  const nx = document.getElementById('nextpage');
  if (nx && i >= 0) nx.innerHTML = i + 1 < PAGES.length
    ? `Next: <a href="${PAGES[i + 1][0]}">${PAGES[i + 1][1]}</a>`
    : `Back to the start: <a href="${PAGES[0][0]}">${PAGES[0][1]}</a>`;
}
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', nav);

return {rng, newSeed, gauss, gamma, beta, studentT, lgamma, betaPdf, locScalePdf, betaInc, betaInv, clopperPearson,
        pA, label, summarize, rectifier, powerTune, posteriors, monteCarlo, mcInterval,
        fmt, pct, ticks, chart, hist, svgOut, PAGES};
})();
if (typeof module !== 'undefined') module.exports = PPI;
