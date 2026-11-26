/* =====================================================================
   Projectile Motion Lab
   ---------------------------------------------------------------------
   1. Physics          – closed-form equations (no numeric drift)
   2. Formatting       – user-selectable precision (default 4 → 0.0001)
   3. Time table       – exact peak (Vy = 0) and landing rows inserted
   4. Canvas renderer  – cached static layer + 5 animation styles
   5. Playback         – real-time clock, speed, scrub, pause at peak
   6. Virtual table    – renders only visible rows (handles 100k+ rows)
   ===================================================================== */
'use strict';

const G = 9.81;                 // gravity (m/s²)
const MAX_ROWS = 2_000_000;     // safety cap for the time table
const ROW_H = 34;               // px – must match .row height in CSS
const $ = (id) => document.getElementById(id);

const app = {
  model: null,      // physics results for the current inputs
  dt: 0.1,          // table time step
  times: null,      // Float64Array of table times (sorted)
  peakRow: -1,      // index of the Vy = 0 row in `times`
  precision: 4,
  style: 'classic',
  t: 0,             // current animation time (s)
  playing: false,
  rate: 1,
  lastFrame: 0,
  raf: 0,
  peakCollapsed: false,   // peak callout minimized to a small pill (tap it to toggle)
};

/* ─────────────────────────── 1. Physics ─────────────────────────── */

function buildModel(speed, deg, wind) {
  const zero = speed === 0;
  const a = (deg * Math.PI) / 180;
  const vx = zero ? wind : speed * Math.cos(a) + wind;
  const vy = zero ? 0 : speed * Math.sin(a);
  const T = zero ? 5 : (2 * vy) / G;        // flight time (5 s demo view when speed = 0)
  const tPeak = vy / G;                       // Vy(t) = vy − g·t = 0  →  t = vy / g
  const H = (vy * vy) / (2 * G);              // max height
  return { zero, vx, vy, T, tPeak, H, R: vx * T, xPeak: vx * tPeak };
}

/** Exact state at time t (closed form). */
function stateAt(m, t) {
  const atPeak = !m.zero && t === m.tPeak;
  return {
    t,
    x: m.vx * t,
    y: atPeak ? m.H : Math.max(0, m.vy * t - 0.5 * G * t * t),
    vx: m.vx,
    vy: atPeak ? 0 : m.vy - G * t,
  };
}

/* ─────────────────────────── 2. Formatting ─────────────────────────── */

function fmt(n, p = app.precision) {
  if (Math.abs(n) < 0.5 * 10 ** -p) n = 0;   // avoid "-0.0000"
  return n.toFixed(p);
}

/* ─────────────────────────── 3. Time table ─────────────────────────── */

function buildTimes(m, dt) {
  const n = Math.max(1, Math.ceil(m.T / dt - 1e-9));   // grid points strictly before landing
  if (n + 2 > MAX_ROWS) return null;
  const eps = Math.min(dt * 1e-6, 1e-9);
  const out = new Float64Array(n + 2);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    if (t < m.T - eps) out[k++] = t;
  }
  out[k++] = m.T;                                       // exact landing row

  let times = out.subarray(0, k);
  let peakRow = -1;
  if (!m.zero) {
    const j = lowerBound(times, m.tPeak - eps);
    if (j < times.length && Math.abs(times[j] - m.tPeak) <= eps) {
      times[j] = m.tPeak;                               // grid already hits the peak
      peakRow = j;
    } else {                                            // insert the exact peak row
      const ins = new Float64Array(times.length + 1);
      ins.set(times.subarray(0, j), 0);
      ins[j] = m.tPeak;
      ins.set(times.subarray(j), j + 1);
      times = ins;
      peakRow = j;
    }
  }
  return { times, peakRow };
}

/** First index i with arr[i] >= v. */
function lowerBound(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid; }
  return lo;
}

/* ─────────────────────────── 4. Canvas renderer ─────────────────────────── */

const canvas = $('stage');
const ctx = canvas.getContext('2d');
const staticLayer = document.createElement('canvas');   // grid, axes, path, markers
const sctx = staticLayer.getContext('2d');
const view = { w: 0, h: 0, dpr: 1, pad: { l: 64, r: 26, t: 26, b: 48 }, X: null, Y: null };
let staticDirty = true;
const MONO = getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace';

const isDark = () => document.documentElement.dataset.theme === 'dark';

/** Colour palette per animation style (some follow the site theme). */
function palette(style = app.style) {
  const dark = isDark();
  const base = dark
    ? { bg: '#050505', grid: 'rgba(255,255,255,.06)', axis: '#4a4a4a', text: '#8f8f8f',
        path: '#aeaeb2', ball: '#f43f5e', ring: '#050505', peak: '#fbbf24', land: '#8f8f8f',
        vx: '#22d3ee', vy: '#f472b6', v: '#fbbf24', box: 'rgba(10,10,10,.94)', boxText: '#ededed' }
    : { bg: '#ffffff', grid: '#edf0f5', axis: '#94a0b8', text: '#5b6478',
        path: '#48484a', ball: '#e11d48', ring: '#ffffff', peak: '#f59e0b', land: '#64748b',
        vx: '#0891b2', vy: '#db2777', v: '#d97706', box: 'rgba(255,255,255,.95)', boxText: '#0f172a' };
  if (style === 'neon') return { ...base, bg: '#000000', grid: 'rgba(255,255,255,.05)', axis: '#333333',
    text: '#777777', path: '#22d3ee', ball: '#f0abfc', ring: '#000000', peak: '#fde047', land: '#777777',
    box: 'rgba(0,0,0,.9)', boxText: '#e0f2fe' };
  if (style === 'blueprint') return { ...base, bg: '#0b3a75', grid: 'rgba(255,255,255,.09)', axis: 'rgba(255,255,255,.75)',
    text: 'rgba(255,255,255,.7)', path: '#ffffff', ball: '#ffffff', ring: '#0b3a75', peak: '#fde68a', land: '#bfdbfe',
    box: 'rgba(8,44,92,.95)', boxText: '#ffffff' };
  return base;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.w = rect.width; view.h = rect.height; view.dpr = dpr;
  const small = rect.width < 520;
  view.pad.l = small ? 44 : 64;
  view.pad.r = small ? 12 : 26;
  view.pad.t = small ? 14 : 26;
  view.pad.b = small ? 42 : 48;
  for (const c of [canvas, staticLayer]) {
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
  }
  staticDirty = true;
  draw();
}

function computeScale() {
  const m = app.model, { w, h, pad } = view;
  const x0 = Math.min(0, m.R), x1 = Math.max(0, m.R);
  const xpad = Math.max(1, (x1 - x0) * 0.06);
  const xmin = x0 - xpad, xmax = x1 + xpad;
  const ymax = Math.max(1, m.H * 1.22);
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  Object.assign(view, { xmin, xmax, ymax, pw, ph });
  view.X = (x) => pad.l + ((x - xmin) / (xmax - xmin)) * pw;
  view.Y = (y) => pad.t + ph - (y / ymax) * ph;
}

/** "Nice" axis ticks: 1, 2, 5 × 10ⁿ */
function niceTicks(min, max, count = 6) {
  const span = max - min, raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((s) => s * mag).find((s) => span / s <= count) || 10 * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(+v.toFixed(10));
  const dec = Math.max(0, -Math.floor(Math.log10(step)));
  return { ticks, dec };
}

function tracePath(c, t0, t1, samples) {
  const m = app.model;
  c.beginPath();
  for (let i = 0; i <= samples; i++) {
    const s = stateAt(m, t0 + ((t1 - t0) * i) / samples);
    const px = view.X(s.x), py = view.Y(s.y);
    i ? c.lineTo(px, py) : c.moveTo(px, py);
  }
}

function drawStatic() {
  const P = palette(), c = sctx, m = app.model, { w, h, dpr, pad, X, Y } = view;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  c.fillStyle = P.bg;
  c.fillRect(0, 0, w, h);

  const groundY = Y(0), left = pad.l, right = w - pad.r, top = pad.t;

  // Blueprint: fine minor grid
  if (app.style === 'blueprint') {
    c.strokeStyle = 'rgba(255,255,255,.04)'; c.lineWidth = 1; c.beginPath();
    for (let x = left; x <= right; x += 12) { c.moveTo(x + .5, top); c.lineTo(x + .5, groundY); }
    for (let y = groundY; y >= top; y -= 12) { c.moveTo(left, y + .5); c.lineTo(right, y + .5); }
    c.stroke();
  }

  // Grid + tick labels
  c.font = `11px ${MONO}`; c.fillStyle = P.text; c.strokeStyle = P.grid; c.lineWidth = 1;
  const yt = niceTicks(0, view.ymax, 5);
  c.textAlign = 'right'; c.textBaseline = 'middle';
  for (const v of yt.ticks) {
    const py = Math.round(Y(v)) + .5;
    c.beginPath(); c.moveTo(left, py); c.lineTo(right, py); c.stroke();
    c.fillText(v.toFixed(yt.dec), left - 8, py);
  }
  const xt = niceTicks(view.xmin, view.xmax, w < 520 ? 4 : 7);
  c.textAlign = 'center'; c.textBaseline = 'top';
  for (const v of xt.ticks) {
    const px = Math.round(X(v)) + .5;
    c.beginPath(); c.moveTo(px, top); c.lineTo(px, groundY); c.stroke();
    c.fillText(v.toFixed(xt.dec), px, groundY + 8);
  }

  // Axes
  c.strokeStyle = P.axis; c.lineWidth = 1.5; c.beginPath();
  c.moveTo(left, groundY); c.lineTo(right, groundY);
  c.moveTo(left, top); c.lineTo(left, groundY); c.stroke();
  c.fillStyle = P.text; c.font = '12px system-ui, sans-serif';
  c.textAlign = 'center'; c.fillText('x (m)', left + view.pw / 2, groundY + 26);
  c.save(); c.translate(14, top + view.ph / 2); c.rotate(-Math.PI / 2); c.fillText('y (m)', 0, 0); c.restore();

  // Full trajectory (style-specific look)
  const samples = 240;
  c.save();
  c.lineCap = 'round'; c.lineJoin = 'round';
  switch (app.style) {
    case 'classic':   c.strokeStyle = P.path; c.globalAlpha = .55; c.lineWidth = 2.5; c.setLineDash([8, 6]); break;
    case 'neon':      c.strokeStyle = P.path; c.globalAlpha = .18; c.lineWidth = 2; c.setLineDash([2, 6]); break;
    case 'vectors':   c.strokeStyle = P.path; c.globalAlpha = .25; c.lineWidth = 2; break;
    case 'strobe':    c.strokeStyle = P.path; c.globalAlpha = .3; c.lineWidth = 1.5; c.setLineDash([1, 5]); break;
    case 'blueprint': c.strokeStyle = P.path; c.globalAlpha = .5; c.lineWidth = 1.5; c.setLineDash([10, 4, 2, 4]); break;
  }
  tracePath(c, 0, m.T, samples); c.stroke();
  c.restore();

  // Peak guides (dashed lines to both axes) + marker
  if (!m.zero && m.H > 0) {
    const px = X(m.xPeak), py = Y(m.H);
    c.save();
    c.strokeStyle = P.peak; c.globalAlpha = .55; c.lineWidth = 1; c.setLineDash([4, 4]);
    c.beginPath(); c.moveTo(px, py); c.lineTo(px, groundY); c.moveTo(px, py); c.lineTo(left, py); c.stroke();
    c.restore();
    diamond(c, px, py, 6, P.peak);
  }

  // Blueprint dimension lines for H and R
  if (app.style === 'blueprint' && !m.zero) {
    c.save(); c.strokeStyle = 'rgba(255,255,255,.6)'; c.fillStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 1;
    c.font = `11px ${MONO}`; c.textAlign = 'center';
    const dimY = groundY - 14, x0 = X(0), x1 = X(m.R);
    dimLine(c, x0, dimY, x1, dimY); c.textBaseline = 'bottom'; c.fillText(`R = ${fmt(m.R)} m`, (x0 + x1) / 2, dimY - 3);
    const dimX = X(m.xPeak) + 14;
    dimLine(c, dimX, groundY, dimX, Y(m.H)); c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText(`H = ${fmt(m.H)} m`, dimX + 6, (groundY + Y(m.H)) / 2);
    c.restore();
  }

  // Launch + landing points
  dot(c, X(0), groundY, 4, P.land);
  dot(c, X(m.R), groundY, 4, P.land);
}

function dot(c, x, y, r, fill) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = fill; c.fill(); }
function diamond(c, x, y, r, fill) {
  c.beginPath(); c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y); c.closePath();
  c.fillStyle = fill; c.fill();
}
function arrow(c, x0, y0, x1, y1, color, width = 2.5) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 2) return;
  const a = Math.atan2(y1 - y0, x1 - x0), head = Math.min(10, len * 0.45);
  c.strokeStyle = color; c.fillStyle = color; c.lineWidth = width; c.lineCap = 'round';
  c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1 - Math.cos(a) * head * .6, y1 - Math.sin(a) * head * .6); c.stroke();
  c.beginPath(); c.moveTo(x1, y1);
  c.lineTo(x1 - head * Math.cos(a - .42), y1 - head * Math.sin(a - .42));
  c.lineTo(x1 - head * Math.cos(a + .42), y1 - head * Math.sin(a + .42));
  c.closePath(); c.fill();
}
function dimLine(c, x0, y0, x1, y1) {
  c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  const a = Math.atan2(y1 - y0, x1 - x0), t = 4;
  for (const [x, y] of [[x0, y0], [x1, y1]]) {     // architectural tick marks
    c.beginPath();
    c.moveTo(x - t * Math.cos(a + Math.PI / 4), y - t * Math.sin(a + Math.PI / 4));
    c.lineTo(x + t * Math.cos(a + Math.PI / 4), y + t * Math.sin(a + Math.PI / 4));
    c.stroke();
  }
}
function ball(c, x, y, P, r = 8) {
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = P.ball; c.fill();
  c.lineWidth = 2.5; c.strokeStyle = P.ring; c.stroke();
}

/** Dynamic part of each animation style. */
const STYLES = {
  classic(c, P, s) {
    const m = app.model;
    c.save(); c.strokeStyle = P.path; c.lineWidth = 3; c.lineCap = 'round'; c.lineJoin = 'round';
    tracePath(c, 0, s.t, Math.max(2, Math.ceil(160 * s.t / m.T))); c.stroke(); c.restore();
    ball(c, view.X(s.x), view.Y(s.y), P, 9);
  },

  neon(c, P, s) {
    const m = app.model;
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.shadowColor = P.path; c.shadowBlur = 16; c.strokeStyle = P.path; c.lineWidth = 3;
    tracePath(c, 0, s.t, Math.max(2, Math.ceil(160 * s.t / m.T))); c.stroke();
    // comet tail: fading particles behind the ball
    c.shadowBlur = 0;
    const tail = 26, gap = m.T * 0.0065;
    for (let k = tail; k >= 1; k--) {
      const tk = s.t - k * gap;
      if (tk < 0) continue;
      const p = stateAt(m, tk), f = 1 - k / tail;
      c.globalAlpha = f * 0.85;
      dot(c, view.X(p.x), view.Y(p.y), 1.5 + f * 6, k % 2 ? '#a78bfa' : '#f0abfc');
    }
    c.globalAlpha = 1;
    const bx = view.X(s.x), by = view.Y(s.y);
    const g = c.createRadialGradient(bx, by, 0, bx, by, 26);
    g.addColorStop(0, 'rgba(240,171,252,.9)'); g.addColorStop(.35, 'rgba(167,139,250,.35)'); g.addColorStop(1, 'rgba(167,139,250,0)');
    c.fillStyle = g; c.beginPath(); c.arc(bx, by, 26, 0, Math.PI * 2); c.fill();
    dot(c, bx, by, 6, '#ffffff');
    c.restore();
  },

  vectors(c, P, s) {
    const m = app.model, bx = view.X(s.x), by = view.Y(s.y);
    c.save();
    c.strokeStyle = P.path; c.lineWidth = 2.5; c.lineCap = 'round';
    tracePath(c, 0, s.t, Math.max(2, Math.ceil(160 * s.t / m.T))); c.stroke();
    // projections to the axes
    c.setLineDash([3, 4]); c.lineWidth = 1; c.strokeStyle = P.text; c.globalAlpha = .6;
    c.beginPath(); c.moveTo(bx, by); c.lineTo(bx, view.Y(0)); c.moveTo(bx, by); c.lineTo(view.pad.l, by); c.stroke();
    c.setLineDash([]); c.globalAlpha = 1;
    // velocity arrows, scaled to the launch speed
    const { ex, ey } = vectorGeom(s);
    arrow(c, bx, by, ex, by, P.vx);
    arrow(c, bx, by, bx, ey, P.vy);
    c.globalAlpha = .9; arrow(c, bx, by, ex, ey, P.v, 3); c.globalAlpha = 1;
    // labels on a dark pill so they stay readable over the curve / peak box
    c.font = `600 ${view.w < 520 ? 10 : 11}px ${MONO}`; c.textBaseline = 'middle';
    pillLabel(c, `Vx ${fmt(s.vx, 2)}`, ex + (s.vx >= 0 ? 8 : -8), by, P.vx, P, s.vx >= 0 ? 'left' : 'right');
    if (Math.abs(ey - by) > 4) pillLabel(c, `Vy ${fmt(s.vy, 2)}`, bx + 10, ey, P.vy, P, 'left');
    ball(c, bx, by, P, 8);
    c.restore();
  },

  strobe(c, P, s) {
    const m = app.model, frames = 18, step = m.T / frames;
    c.save();
    const shots = [];
    for (let i = 0; i * step <= s.t + 1e-12; i++) shots.push(i * step);
    if (!m.zero && s.t >= m.tPeak) shots.push(m.tPeak);
    for (const tk of shots) {
      const p = stateAt(m, tk), x = view.X(p.x), y = view.Y(p.y);
      const age = (s.t - tk) / m.T;
      c.globalAlpha = 0.18; c.strokeStyle = P.text; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x, view.Y(0)); c.stroke();
      c.globalAlpha = Math.max(.25, .85 - age);
      c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2);
      c.fillStyle = tk === m.tPeak ? P.peak : P.path; c.fill();
    }
    c.globalAlpha = 1;
    ball(c, view.X(s.x), view.Y(s.y), P, 9);
    c.restore();
  },

  blueprint(c, P, s) {
    const m = app.model, bx = view.X(s.x), by = view.Y(s.y), g = view.Y(0), L = view.pad.l;
    c.save();
    c.strokeStyle = P.path; c.lineWidth = 2; c.lineCap = 'round';
    tracePath(c, 0, s.t, Math.max(2, Math.ceil(160 * s.t / m.T))); c.stroke();
    // coordinate ticks on both axes
    c.strokeStyle = 'rgba(253,230,138,.9)'; c.lineWidth = 1; c.setLineDash([2, 3]);
    c.beginPath(); c.moveTo(bx, by); c.lineTo(bx, g); c.moveTo(bx, by); c.lineTo(L, by); c.stroke();
    c.setLineDash([]);
    c.font = `11px ${MONO}`; c.fillStyle = '#fde68a';
    c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText(fmt(s.x, 2), bx, g - 2);
    c.textAlign = 'left'; c.textBaseline = 'bottom'; c.fillText(fmt(s.y, 2), L + 4, by - 2);
    // crosshair projectile
    c.strokeStyle = '#fff'; c.lineWidth = 1.5;
    c.beginPath(); c.arc(bx, by, 9, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(bx - 15, by); c.lineTo(bx + 15, by); c.moveTo(bx, by - 15); c.lineTo(bx, by + 15); c.stroke();
    dot(c, bx, by, 2.5, '#fff');
    c.restore();
  },
};

/** Screen geometry of the velocity arrows (shared by the vectors style and the callout placement). */
function vectorGeom(s) {
  const m = app.model, bx = view.X(s.x), by = view.Y(s.y);
  const k = (Math.min(view.pw, view.ph) * 0.3) / Math.max(Math.hypot(m.vx, m.vy), 1);
  return { bx, by, ex: bx + s.vx * k, ey: by - s.vy * k };
}

/** Text on a small rounded backing; kept inside the canvas. */
function pillLabel(c, text, x, y, color, P, align) {
  const w = c.measureText(text).width, h = 16, padX = 5;
  let left = align === 'left' ? x : x - w;
  left = Math.max(4 + padX, Math.min(view.w - w - 4 - padX, left));
  c.fillStyle = P.box; c.globalAlpha = .85;
  c.beginPath(); c.roundRect(left - padX, y - h / 2, w + padX * 2, h, 5); c.fill();
  c.globalAlpha = 1; c.textAlign = 'left'; c.fillStyle = color; c.fillText(text, left, y + .5);
}

/** Distance from point (x, y) to rectangle r (0 if inside). */
function rectDist(r, x, y) {
  const dx = Math.max(r.x - x, 0, x - (r.x + r.w)), dy = Math.max(r.y - y, 0, y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/**
 * Peak callout, placed in whichever free spot is farthest from the ball,
 * its velocity arrows, the peak marker and the trajectory. A dashed leader
 * line ties it to the peak. Tap/click it to collapse it to a small pill.
 */
function drawPeakCallout(c, P, s) {
  const m = app.model, small = view.w < 520;
  const px = view.X(m.xPeak), py = view.Y(m.H);

  // halo around the peak marker
  c.save();
  c.strokeStyle = P.peak; c.globalAlpha = .5; c.lineWidth = 1.5;
  c.beginPath(); c.arc(px, py, 12, 0, Math.PI * 2); c.stroke();
  c.globalAlpha = 1;

  const fs = small ? 10 : 11.5, lh = small ? 13 : 16;
  const lines = app.peakCollapsed
    ? ['PEAK ▸']
    : ['PEAK · Vy = 0', `t = ${fmt(m.tPeak)} s`, `x = ${fmt(m.xPeak)} m`, `y = ${fmt(m.H)} m`];
  c.font = `600 ${fs}px ${MONO}`;
  const bw = Math.max(...lines.map((l) => c.measureText(l).width)) + (small ? 14 : 20);
  const bh = lines.length * lh + (small ? 8 : 12);

  // candidate spots: the 4 plot corners + beside the peak
  const L = view.pad.l + 6, R = view.w - view.pad.r - 6 - bw, T = view.pad.t + 4, B = view.Y(0) - 8 - bh;
  const under = (py + view.Y(0)) / 2 - bh / 2;                 // inside the arch, below the peak
  const cands = [[L, T], [R, T], [px - bw / 2, under], [px - bw / 2, py + 34], [L, B], [R, B], [px + 16, py + 14], [px - bw - 16, py + 14]]
    .map(([x, y]) => ({ x: Math.max(4, Math.min(view.w - bw - 4, x)), y: Math.max(4, Math.min(view.Y(0) - bh - 4, y)), w: bw, h: bh }));

  // things the box must not cover
  const avoid = [[px, py], [view.X(s.x), view.Y(s.y)]];
  if (app.style === 'vectors') {
    const g = vectorGeom(s);
    avoid.push([g.ex, g.by], [g.bx, g.ey], [g.ex, g.ey], [(g.bx + g.ex) / 2, (g.by + g.ey) / 2]);
  }
  const path = [];
  for (let i = 0; i <= 120; i++) { const p = stateAt(m, (m.T * i) / 120); path.push([view.X(p.x), view.Y(p.y)]); }
  // score = clearance from ball/arrows/peak, minus a heavy penalty for every bit of curve the box would cover
  const score = (r) => Math.min(80, ...avoid.map(([x, y]) => rectDist(r, x, y)))
    - 25 * path.filter(([x, y]) => rectDist(r, x, y) < 5).length;

  // hysteresis: only move when another spot is clearly better (no flicker)
  let best = view.calloutIdx ?? 0, bestScore = score(cands[best]);
  cands.forEach((r, i) => { const sc = score(r); if (sc > bestScore + 18) { best = i; bestScore = sc; } });
  view.calloutIdx = best;
  const r = cands[best];
  view.calloutRect = r;

  // leader line from box to peak
  const lx = Math.max(r.x, Math.min(r.x + r.w, px)), ly = Math.max(r.y, Math.min(r.y + r.h, py));
  if (Math.hypot(lx - px, ly - py) > 14) {
    c.strokeStyle = P.peak; c.globalAlpha = .6; c.lineWidth = 1; c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(lx, ly); c.lineTo(px, py); c.stroke();
    c.setLineDash([]); c.globalAlpha = 1;
  }

  c.fillStyle = P.box; c.strokeStyle = P.peak; c.lineWidth = 1.2;
  c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, 8); c.fill(); c.stroke();
  c.textAlign = 'left'; c.textBaseline = 'top';
  lines.forEach((l, i) => {
    c.fillStyle = i === 0 ? P.peak : P.boxText;
    c.font = i === 0 ? `700 ${fs - .5}px ${MONO}` : `${fs}px ${MONO}`;
    c.fillText(l, r.x + (small ? 7 : 10), r.y + (small ? 5 : 7) + i * lh);
  });
  c.restore();
}

/** Draw one frame: blit the cached static layer, then the live layer. */
function draw() {
  if (!app.model || !view.w) return;
  if (staticDirty) { computeScale(); drawStatic(); staticDirty = false; }
  const { dpr } = view, P = palette();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(staticLayer, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = stateAt(app.model, app.t);
  view.calloutRect = null;
  // callout first, so the ball and velocity arrows are always drawn on top of it
  if (!app.model.zero && app.t >= app.model.tPeak) drawPeakCallout(ctx, P, s);
  STYLES[app.style](ctx, P, s);
  updateReadout(s);
  syncTable();
}

/* ─────────────────────────── 5. Playback ─────────────────────────── */

const el = {
  rT: $('rT'), rX: $('rX'), rY: $('rY'), rVx: $('rVx'), rVy: $('rVy'), rV: $('rV'),
  scrub: $('scrub'), status: $('status'), play: $('play'), playLabel: $('playLabel'),
};

function updateReadout(s) {
  el.rT.textContent = fmt(s.t);
  el.rX.textContent = fmt(s.x);
  el.rY.textContent = fmt(s.y);
  el.rVx.textContent = fmt(s.vx);
  el.rVy.textContent = fmt(s.vy);
  el.rV.textContent = fmt(Math.hypot(s.vx, s.vy));
  el.scrub.value = app.model.T ? Math.round((s.t / app.model.T) * 10000) : 0;
}

function setStatus(text, peak = false) {
  el.status.textContent = text;
  el.status.classList.toggle('peak', peak);
}

function setPlaying(on) {
  app.playing = on;
  el.play.classList.toggle('on', on);
  el.playLabel.textContent = on ? 'Pause' : 'Play';
  cancelAnimationFrame(app.raf);
  if (on) { app.lastFrame = performance.now(); app.raf = requestAnimationFrame(tick); }
}

function play() {
  if (!app.model) return;
  if (app.t >= app.model.T) app.t = 0;
  setStatus(app.model.zero ? 'Horizontal motion' : 'In flight');
  setPlaying(true);
}

function pause(text = 'Paused', peak = false) { setPlaying(false); setStatus(text, peak); }

function tick(now) {
  if (!app.playing) return;
  const m = app.model;
  const real = Math.min(0.05, (now - app.lastFrame) / 1000);   // clamp tab-switch jumps
  app.lastFrame = now;
  let next = app.t + real * app.rate;

  if ($('pausePeak').checked && !m.zero && app.t < m.tPeak && next >= m.tPeak) {
    app.t = m.tPeak;                         // land exactly on the peak instant
    pause('Peak reached · Vy = 0', true);
    flashPeak();
    draw();
    return;
  }
  if (next >= m.T) {
    app.t = m.T;
    pause(m.zero ? 'Done' : 'Landed');
    draw();
    return;
  }
  app.t = next;
  draw();
  app.raf = requestAnimationFrame(tick);
}

function seek(t, statusText) {
  const m = app.model;
  app.t = Math.min(m.T, Math.max(0, t));
  if (app.playing) setPlaying(false);
  const atPeak = !m.zero && app.t === m.tPeak;
  setStatus(statusText || (atPeak ? 'At peak · Vy = 0' : app.t >= m.T ? 'Landed' : 'Paused'), atPeak);
  draw();
}

/** Step to the previous/next row of the table (so steps land on exact table times). */
function step(dir) {
  const { times } = app;
  if (!times) return;
  let i = lowerBound(times, app.t);
  if (dir > 0) i = times[i] === app.t ? i + 1 : i;
  else i = i - 1;
  i = Math.min(times.length - 1, Math.max(0, i));
  seek(times[i]);
}

function flashPeak() {
  const card = $('peakCard');
  card.classList.remove('hit'); void card.offsetWidth; card.classList.add('hit');
}

/* ─────────────────────────── 6. Virtual table ─────────────────────────── */

const tbody = $('tbody'), win = $('win'), spacer = $('spacer');
const rendered = { start: -1, end: -1, active: -2, precision: -1 };

function activeRow() {
  const { times } = app;
  if (!times) return -1;
  const i = lowerBound(times, app.t);
  return i < times.length && times[i] === app.t ? i : i - 1;   // last row with time <= t
}

function renderRows(force = false) {
  const { times, model: m } = app;
  if (!times) return;
  const top = tbody.scrollTop, vh = tbody.clientHeight || 560;
  const start = Math.max(0, Math.floor(top / ROW_H) - 8);
  const end = Math.min(times.length, Math.ceil((top + vh) / ROW_H) + 8);
  const active = activeRow();
  if (!force && start === rendered.start && end === rendered.end && active === rendered.active) return;
  Object.assign(rendered, { start, end, active });

  let html = '';
  for (let i = start; i < end; i++) {
    const s = stateAt(m, times[i]);
    let cls = i % 2 ? 'row alt' : 'row';
    if (i === app.peakRow) cls += ' peak';
    if (i === times.length - 1) cls += ' land';
    if (i === active) cls += ' active';
    html += `<div class="${cls}" data-i="${i}"><span>${fmt(s.t)}</span><span>${fmt(s.x)}</span><span>${fmt(s.y)}</span><span>${fmt(s.vx)}</span><span>${fmt(s.vy)}</span></div>`;
  }
  win.style.transform = `translateY(${start * ROW_H}px)`;
  win.innerHTML = html;
}

function syncTable() {
  if (!app.times) return;
  if ($('follow').checked) {
    const i = activeRow();
    if (i >= 0) {
      const y = i * ROW_H, top = tbody.scrollTop, vh = tbody.clientHeight;
      if (y < top || y + ROW_H > top + vh) tbody.scrollTop = Math.max(0, y - vh / 2);
    }
  }
  renderRows();
}

function scrollToRow(i) {
  tbody.scrollTop = Math.max(0, i * ROW_H - tbody.clientHeight / 2 + ROW_H / 2);
  renderRows(true);
}

function downloadCSV() {
  const { times, model: m } = app;
  if (!times) return;
  const p = app.precision, parts = ['t_s,x_m,y_m,vx_mps,vy_mps,event\n'];
  for (let i = 0; i < times.length; i++) {
    const s = stateAt(m, times[i]);
    const ev = i === app.peakRow ? 'peak' : i === times.length - 1 ? 'landing' : '';
    parts.push(`${fmt(s.t, p)},${fmt(s.x, p)},${fmt(s.y, p)},${fmt(s.vx, p)},${fmt(s.vy, p)},${ev}\n`);
  }
  const url = URL.createObjectURL(new Blob(parts, { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'projectile-motion.csv' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ─────────────────────────── Simulate (wires it all together) ─────────────────────────── */

function readInputs() {
  const ids = ['speed', 'angle', 'wind', 'dt'];
  ids.forEach((id) => $(id).removeAttribute('aria-invalid'));
  const v = Object.fromEntries(ids.map((id) => [id, $(id).value.trim() === '' ? NaN : Number($(id).value)]));
  const bad = (id) => { $(id).setAttribute('aria-invalid', 'true'); return null; };

  if (!Number.isFinite(v.speed) || v.speed < 0) return [bad('speed'), 'Initial speed must be 0 or greater.'];
  if (!Number.isFinite(v.angle)) return [bad('angle'), 'Enter a valid launch angle.'];
  if (v.speed > 0 && (v.angle <= 0 || v.angle >= 90)) return [bad('angle'), 'For a positive speed, the angle must be greater than 0 and less than 90 degrees.'];
  if (!Number.isFinite(v.wind)) return [bad('wind'), 'Enter a valid wind speed (it can be negative).'];
  if (!Number.isFinite(v.dt) || v.dt <= 0) return [bad('dt'), 'The time step must be a positive number (e.g. 0.0001).'];
  if (v.dt < 1e-6) return [bad('dt'), 'The smallest supported time step is 0.000001 s.'];
  return [v, ''];
}

function simulate() {
  const [v, err] = readInputs();
  $('error').textContent = err;
  if (!v) return;

  const m = buildModel(v.speed, v.angle, v.wind);
  const table = buildTimes(m, v.dt);
  if (!table) {
    $('dt').setAttribute('aria-invalid', 'true');
    $('error').textContent = `That time step would create more than ${MAX_ROWS.toLocaleString()} rows. Use a larger step.`;
    return;
  }

  app.model = m; app.dt = v.dt; app.times = table.times; app.peakRow = table.peakRow;
  app.precision = Number($('precision').value);
  saveToURL(v);
  renderSummary();

  spacer.style.height = `${app.times.length * ROW_H}px`;
  tbody.scrollTop = 0;
  const last = app.times.length - 1;
  $('tableNote').textContent =
    `${app.times.length.toLocaleString()} rows · step ${v.dt} s` +
    (m.zero ? '' : ` · peak row #${app.peakRow + 1} (exact, Vy = 0)`) +
    ` · final row #${last + 1} is the exact ${m.zero ? 'end time' : 'landing time'}.`;

  setPlaying(false);
  app.t = 0;
  setStatus(m.zero ? 'Horizontal motion (5 s view)' : 'Ready');
  staticDirty = true;
  renderRows(true);
  draw();
}

function renderSummary() {
  const m = app.model;
  $('mFlight').textContent = `${fmt(m.T)} s`;
  $('mHeight').textContent = `${fmt(m.H)} m`;
  $('mRange').textContent = `${fmt(m.R)} m`;
  $('mVx').textContent = `${fmt(m.vx)} m/s`;
  $('mVy').textContent = `${fmt(m.vy)} m/s`;

  const set = (id, val, unit) => { $(id).innerHTML = `${val}<small>${unit}</small>`; };
  if (m.zero) {
    ['pT', 'pX', 'pY', 'pVx', 'pVy', 'pV'].forEach((id) => { $(id).textContent = '–'; });
    $('peakNote').textContent = 'Speed is 0, so there is no vertical motion and no peak.';
    $('gotoPeak').disabled = true;
    return;
  }
  $('peakNote').innerHTML = 'The instant the projectile stops rising: t = V<sub>y0</sub> / g';
  $('gotoPeak').disabled = false;
  set('pT', fmt(m.tPeak), 's');
  set('pX', fmt(m.xPeak), 'm');
  set('pY', fmt(m.H), 'm');
  set('pVx', fmt(m.vx), 'm/s');
  set('pVy', fmt(0), 'm/s');
  set('pV', fmt(Math.abs(m.vx)), 'm/s');
}

/* Shareable links: ?v=25&a=45&w=0&dt=0.1&p=4&s=neon */
function saveToURL(v) {
  const q = new URLSearchParams({ v: v.speed, a: v.angle, w: v.wind, dt: v.dt, p: $('precision').value, s: app.style });
  history.replaceState(null, '', `?${q}`);
}
function loadFromURL() {
  const q = new URLSearchParams(location.search);
  const map = { v: 'speed', a: 'angle', w: 'wind', dt: 'dt', p: 'precision' };
  for (const [k, id] of Object.entries(map)) if (q.has(k)) $(id).value = q.get(k);
  if (STYLES[q.get('s')]) selectStyle(q.get('s'), false);
}

function selectStyle(name, redraw = true) {
  app.style = name;
  document.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.style === name)));
  if (!redraw) return;
  staticDirty = true;
  draw();
  if (app.model) {
    const q = new URLSearchParams(location.search); q.set('s', name);
    history.replaceState(null, '', `?${q}`);
  }
}

/* ─────────────────────────── Events ─────────────────────────── */

$('form').addEventListener('submit', (e) => { e.preventDefault(); simulate(); });
$('precision').addEventListener('change', () => {
  if (!app.model) return;
  app.precision = Number($('precision').value);
  renderSummary(); staticDirty = true; renderRows(true); draw();
});
$('play').addEventListener('click', () => (app.playing ? pause() : play()));
$('reset').addEventListener('click', () => seek(0, app.model?.zero ? 'Horizontal motion (5 s view)' : 'Ready'));
$('back').addEventListener('click', () => step(-1));
$('fwd').addEventListener('click', () => step(1));
$('rate').addEventListener('change', (e) => { app.rate = Number(e.target.value); });
$('scrub').addEventListener('input', (e) => app.model && seek((e.target.value / 10000) * app.model.T));
$('gotoPeak').addEventListener('click', () => {
  if (!app.model || app.model.zero) return;
  seek(app.model.tPeak);
  scrollToRow(app.peakRow);
  flashPeak();
});
$('csv').addEventListener('click', downloadCSV);

// Tap / click the peak box to collapse or expand it
const inCallout = (e) => {
  const r = view.calloutRect;
  if (!r) return false;
  const b = canvas.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
  return x >= r.x - 6 && x <= r.x + r.w + 6 && y >= r.y - 6 && y <= r.y + r.h + 6;   // a little slack for fingers
};
canvas.addEventListener('click', (e) => {
  if (!inCallout(e)) return;
  app.peakCollapsed = !app.peakCollapsed;
  draw();
});
canvas.addEventListener('pointermove', (e) => { canvas.style.cursor = inCallout(e) ? 'pointer' : ''; });
document.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => selectStyle(b.dataset.style)));
let rowsQueued = false;                          // at most one table re-render per frame
tbody.addEventListener('scroll', () => {
  if (rowsQueued) return;
  rowsQueued = true;
  requestAnimationFrame(() => { rowsQueued = false; renderRows(); });
}, { passive: true });
tbody.addEventListener('click', (e) => {          // click a row → jump the animation to that time
  const row = e.target.closest('.row');
  if (row) seek(app.times[Number(row.dataset.i)]);
});
$('themeBtn').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('pml-theme', next);
  staticDirty = true; draw();
});
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea, button') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Space') { e.preventDefault(); app.playing ? pause() : play(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
});
new ResizeObserver(resizeCanvas).observe(canvas);

loadFromURL();
simulate();
