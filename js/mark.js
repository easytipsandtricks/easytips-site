// The EasyTipsAndTricks mark (lightbulb + gear + check) as plain 2D geometry, in a 240 × 240 box, y down (SVG units).
// story.js extrudes these outlines into the 3D mark; markSvg() gives the same mark as an SVG string.
// Recreated by hand from the channel logo (assets/logo-stacked.jpg); no image tracing, no external assets.

export const BLUE = '#1f86f5', BLUE_DARK = '#0b5fc4', WHITE = '#f4f6f9'
export const MARK = {
  ring: { cx: 92.5, cy: 87, rxo: 73, ryo: 69, rxi: 57.5, ryi: 54, from: 143, to: 348 }, // bulb glass: an elliptic arc (degrees, y down) open at the lower right
  dot: { cx: 94, cy: 26.5, r: 4.2 },                                   // the glint on top of the bulb
  gear: { cx: 94.5, cy: 91, tip: 41, root: 33.5, hole: 19.5, teeth: 8, tipW: 0.42, rootW: 0.62 },
  bigGear: { cx: 134, cy: 136, tip: 59, root: 49.5, hole: 0, teeth: 11, tipW: 0.44, rootW: 0.6 },
  // check: short arm from the left, vertex at the bottom, long arm to the upper right
  check: [[14, 145], [43, 132], [82.5, 170], [197, 46], [216, 42], [210, 64], [82.5, 214]],
  // the gap along the check's long arm that hides the big gear's left part: a line (point, direction) and its offset
  cut: { p: [82.5, 214], d: [210 - 82.5, 64 - 214], gap: 6.5 },
  base: [{ x: 56, y: 209, w: 76, h: 10, r: 5 }, { x: 72, y: 225, w: 44, h: 9, r: 4.5 }],
}

const rad = d => d * Math.PI / 180
// arc points from angle a0 to a1 (degrees, y down), n segments
export function arc(cx, cy, r, a0, a1, n = 48, ry = r) {
  const p = []
  for (let i = 0; i <= n; i++) { const a = rad(a0 + (a1 - a0) * i / n); p.push([cx + r * Math.cos(a), cy + ry * Math.sin(a)]) }
  return p
}
// ring outline: outer arc forward, inner arc back (closed polygon)
export function ringOutline(g = MARK.ring, n = 64) {
  const a0 = g.from, a1 = g.to < g.from ? g.to + 360 : g.to
  return [...arc(g.cx, g.cy, g.rxo, a0, a1, n, g.ryo), ...arc(g.cx, g.cy, g.rxi, a1, a0, n, g.ryi)]
}
// gear outline centred at the origin (teeth: trapezoids, flanks straight); tipW/rootW = tooth width as a fraction of the pitch
export function gearOutline(g, steps = 6) {
  const p = [], pitch = 2 * Math.PI / g.teeth
  for (let k = 0; k < g.teeth; k++) {
    const c = k * pitch - Math.PI / 2, ht = pitch * g.tipW / 2, hr = pitch * g.rootW / 2
    const rootArc = (a0, a1) => { for (let i = 0; i <= steps; i++) { const a = a0 + (a1 - a0) * i / steps; p.push([g.root * Math.cos(a), g.root * Math.sin(a)]) } }
    rootArc(c - pitch / 2, c - hr)
    for (let i = 0; i <= steps; i++) { const a = c - ht + 2 * ht * i / steps; p.push([g.tip * Math.cos(a), g.tip * Math.sin(a)]) }
    rootArc(c + hr, c + pitch / 2)
  }
  return p
}
export const circle = (r, n = 40) => arc(0, 0, r, 0, 360, n).slice(0, -1)
export function roundRect({ x, y, w, h, r }, n = 6) {
  const p = [], c = (cx, cy, a0) => { for (let i = 0; i <= n; i++) { const a = rad(a0 + 90 * i / n); p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]) } }
  c(x + w - r, y + r, -90); c(x + w - r, y + h - r, 0); c(x + r, y + h - r, 90); c(x + r, y + r, 180)
  return p
}

const pts = p => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
const path = p => 'M' + p.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') + 'Z'
// SVG string of the whole mark (the big gear clipped by the check's gap line, as in the logo)
export function markSvg({ size = 240, title = '' } = {}) {
  const M = MARK, g = M.gear, b = M.bigGear, { p, d, gap } = M.cut
  const L = Math.hypot(d[0], d[1]), n = [-d[1] / L, d[0] / L]                // normal pointing to the gear side (right/down)
  const q = [p[0] + n[0] * gap, p[1] + n[1] * gap], far = 400
  const clip = [[q[0] - d[0] / L * far, q[1] - d[1] / L * far], [q[0] + d[0] / L * far, q[1] + d[1] / L * far],
    [q[0] + d[0] / L * far + n[0] * far, q[1] + d[1] / L * far + n[1] * far], [q[0] - d[0] / L * far + n[0] * far, q[1] - d[1] / L * far + n[1] * far]]
  const gearPath = (G, hole) => path(gearOutline(G).map(([x, y]) => [x + G.cx, y + G.cy])) + (hole ? path(circle(hole).map(([x, y]) => [x + G.cx, y + G.cy]).reverse()) : '')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="${size}" height="${size}"${title ? ` role="img" aria-label="${title}"` : ' aria-hidden="true"'}>` +
    `<defs><clipPath id="mk-cut"><polygon points="${pts(clip)}"/></clipPath></defs>` +
    `<path d="${gearPath(b, 0)}" fill="${WHITE}" clip-path="url(#mk-cut)"/>` +
    `<path d="${path(ringOutline())}" fill="${BLUE}"/>` +
    `<circle cx="${M.dot.cx}" cy="${M.dot.cy}" r="${M.dot.r}" fill="#fff"/>` +
    `<path d="${gearPath(g, g.hole)}" fill="${WHITE}" fill-rule="evenodd"/>` +
    M.base.map(r => `<path d="${path(roundRect(r))}" fill="${BLUE}"/>`).join('') +
    `<polygon points="${pts(M.check)}" fill="${BLUE}"/>` +
    `</svg>`
}
