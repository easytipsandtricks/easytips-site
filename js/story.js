// story.js — the homepage's scroll-driven 3D story (spec 0006). One fixed WebGL canvas behind the content.
//   act 0 our car glides in · 0→1 an x-ray sweep shows the engine firing · 1→2 the car drives off, a sheet of paper lands
//   and the Snow Hero draws itself · 2→3 paper snowflakes unfold · 3→4 the lightbulb-gear-check mark assembles; its gear
//   turns and the mark tilts toward the pointer.
// Story time T (0…4) comes from the scroll position (T = k when chapter k is centred) and eases toward it; nothing hijacks
// the scroll. createStory() renders any (T, clock) on demand (used by the stills capture too); mount() runs the page loop.
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import '../vendor/det.js'
import { makeCar, makeEngine, makeStage, studioEnvironment, contactShadow, STAGE, COLORS, util } from './scene3d.js'
import { MARK, ringOutline, gearOutline, circle, roundRect } from './mark.js'

const { clamp, lerp } = util
const DEG = Math.PI / 180
const eio = x => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 }
const eo = x => 1 - Math.pow(1 - clamp(x), 3)
const ein = x => { x = clamp(x); return x * x }
const back = x => { x = clamp(x); const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2) }
const ramp = (T, a, b) => clamp((T - a) / (b - a))
const lin = hex => new THREE.Color(hex)
export const ACTS = 4

// ───────────────────────── layout: where the subject may sit (fractions of the viewport) ─────────────────────────
// Wide screens: text on the left, subject on the right. Narrow/portrait: subject in the upper half, text below.
export function safeArea(w, h, layout = 'page') {
  if (layout === 'center') return { x0: 0.05, x1: 0.95, y0: 0.07, y1: 0.93 }
  if (layout === 'poster') return { x0: 0.50, x1: 0.985, y0: 0.1, y1: 0.92 }
  return (w / h >= 1.05 && w >= 760) ? { x0: 0.47, x1: 0.97, y0: 0.12, y1: 0.93 } : { x0: 0.04, x1: 0.96, y0: 0.09, y1: 0.50 }
}

// Camera keys on story time: target, orbit (az from +z toward +x, el), fov and the subject size (sw × sh, world units)
// that must fit the safe area — the distance follows from the screen shape, so phones and wide screens both frame it.
const KEYS = [
  [0.00, { tx: 0.05, ty: 0.58, tz: 0, az: 36, el: 7, fov: 28, sw: 5.3, sh: 2.1 }],
  [0.22, { tx: 0.05, ty: 0.58, tz: 0, az: 36, el: 7, fov: 28, sw: 5.3, sh: 2.1 }],
  [0.95, { tx: 0.30, ty: 0.55, tz: 0, az: 22, el: 17, fov: 28, sw: 5.0, sh: 2.5 }],
  [1.06, { tx: 0.85, ty: 0.55, tz: 0, az: 19, el: 20, fov: 28, sw: 3.9, sh: 2.3 }],
  [1.62, { tx: 0.0, ty: 0.0, tz: 0.04, az: 0, el: 66, fov: 30, sw: 2.3, sh: 2.75 }],
  [2.12, { tx: 0.0, ty: 0.0, tz: 0.04, az: 0, el: 70, fov: 30, sw: 2.25, sh: 2.65 }],
  [2.55, { tx: 0.0, ty: 1.05, tz: -1.4, az: 0, el: 30, fov: 30, sw: 3.3, sh: 2.6 }],
  [2.95, { tx: 0.0, ty: 1.70, tz: -2.6, az: 0, el: 6, fov: 30, sw: 3.5, sh: 2.5 }],
  [3.30, { tx: 0.0, ty: 1.72, tz: -2.8, az: 0, el: 4, fov: 30, sw: 3.2, sh: 2.4 }],
  [3.95, { tx: 0.0, ty: 1.75, tz: -3.2, az: 0, el: 2, fov: 28, sw: 1.8, sh: 1.8 }],
]
function camAt(T) {
  let i = 0; while (i < KEYS.length - 1 && KEYS[i + 1][0] <= T) i++
  const [ta, a] = KEYS[i], n = KEYS[i + 1]
  if (!n || T <= ta) return { ...a }
  const p = eio((T - ta) / (n[0] - ta)), o = {}
  for (const k in a) o[k] = lerp(a[k], n[1][k], p)
  return o
}

// ───────────────────────── the Snow Hero drawing (paper-local px, paper 820 × 960) ─────────────────────────
// Geometry ideas from Drawing Tips 02 (our own Power-Up Snow Hero): three snowballs, stick arms, mittens, ice crown,
// carrot nose, scarf, buttons and a frost aura.
function ell(cx, cy, rx, ry, a0, a1, n = 64) { const p = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; p.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]) } return p }
function quad(p0, c, p1, n = 24) { const p = []; for (let i = 0; i <= n; i++) { const s = i / n; p.push([(1 - s) * (1 - s) * p0[0] + 2 * s * (1 - s) * c[0] + s * s * p1[0], (1 - s) * (1 - s) * p0[1] + 2 * s * (1 - s) * c[1] + s * s * p1[1]]) } return p }
const mir = pts => pts.map(p => [820 - p[0], p[1]])
const circStroke = (cx, cy, r) => ell(cx, cy, r, r, -Math.PI / 2, 1.5 * Math.PI + 0.16, 96)   // starts at the top, overshoots a little
function crescent(cx, cy, r) {
  const ir = r - 6, out = [], inn = []
  for (let i = 0; i <= 120; i++) {
    const th = Math.PI / 4 - Math.PI + 2 * Math.PI * i / 120, u = [Math.cos(th), Math.sin(th)]
    const du = 16 * u[0] + 16 * u[1], s = -du + Math.sqrt(du * du - (512 - ir * ir))
    if (s < r) { out.push([cx + r * u[0], cy + r * u[1]]); inn.push([cx + s * u[0], cy + s * u[1]]) }
  }
  return [...out, ...inn.reverse()]
}
function mitten() {
  const m = [190, 236], rx = 26, ry = 30, tc = [214, 248], trx = 10, tr_y = 13, ta = 30 * DEG, pts = []
  const rot = (x, y) => [x * Math.cos(-ta) - y * Math.sin(-ta), x * Math.sin(-ta) + y * Math.cos(-ta)]
  for (let i = 0; i <= 96; i++) {
    const th = 3 * Math.PI / 4 + 2 * Math.PI * i / 96, u = [Math.cos(th), Math.sin(th)]
    let r = 1 / Math.hypot(u[0] / rx, u[1] / ry)
    const [lx, ly] = rot(m[0] - tc[0], m[1] - tc[1]), [ux, uy] = rot(u[0], u[1])
    const A = (ux / trx) ** 2 + (uy / tr_y) ** 2, B = 2 * (lx * ux / trx ** 2 + ly * uy / tr_y ** 2), Cc = (lx / trx) ** 2 + (ly / tr_y) ** 2 - 1, disc = B * B - 4 * A * Cc
    if (disc > 0) { const s = (-B + Math.sqrt(disc)) / (2 * A); if (s > r) r = s }
    pts.push([m[0] + u[0] * r, m[1] + u[1] * r])
  }
  return pts
}
function flame(top, bottom, W, Wl, yA = 250, yB = 400, yC = 720) {
  const side = []
  for (let y = top; y <= yC; y += 4) {
    let w
    if (y <= yA) w = W * Math.pow(Math.sin(clamp((y - top) / (yA - top)) * Math.PI / 2), 0.75)
    else if (y <= yB) w = W
    else { const q = (y - yB) / (yC - yB); w = lerp(W, Wl, q * q * (3 - 2 * q)) }
    side.push([410 + w, y])
  }
  for (let a = 3; a <= 90; a += 3) { const r = a * DEG; side.push([410 + Wl * Math.cos(r), yC + (bottom - yC) * Math.sin(r)]) }
  const left = side.map(p => [820 - p[0], p[1]]).reverse()
  return [[410, bottom], ...left, ...side.slice(1), [410, bottom]]
}
function wavy(base, amp, waves) {
  const cum = [0]; for (let i = 1; i < base.length; i++) cum.push(cum[i - 1] + Math.hypot(base[i][0] - base[i - 1][0], base[i][1] - base[i - 1][1]))
  const L = cum[cum.length - 1], n = base.length
  return base.map((p, i) => {
    const a = base[Math.max(0, i - 2)], b = base[Math.min(n - 1, i + 2)]
    let nx = b[1] - a[1], ny = -(b[0] - a[0]); const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l
    if (nx * (p[0] - 410) + ny * (p[1] - 470) < 0) { nx = -nx; ny = -ny }
    const w = amp * Math.sin(2 * Math.PI * waves * cum[i] / L)
    return [p[0] + nx * w, p[1] + ny * w]
  })
}
const INK = '#1F2328'
function heroDrawing() {
  const crownZig = [[338, 178], [312, 128], [356, 140], [346, 78], [390, 122], [410, 40], [430, 122], [474, 78], [464, 140], [508, 128], [482, 178]]
  const crownBase = quad([482, 178], [410, 196], [338, 178], 20)
  const band = [...quad([334, 286], [410, 318], [486, 286], 20), ...quad([488, 320], [410, 352], [332, 320], 20), [334, 286]]
  const tail = (() => { const a = [446, 318], z = [474, 412], L = Math.hypot(z[0] - a[0], z[1] - a[1]), d = [(z[0] - a[0]) / L, (z[1] - a[1]) / L], n = [-d[1], d[0]]
    return [[a[0] + n[0] * 19, a[1] + n[1] * 19], [z[0] + n[0] * 17, z[1] + n[1] * 17], [z[0] - n[0] * 17, z[1] - n[1] * 17], [a[0] - n[0] * 19, a[1] - n[1] * 19]] })()
  const nose = [[408, 232], [470, 243], [474, 245], [470, 247], [408, 254], [408, 232]]
  const armL = [[302, 392], [228, 330], [198, 266]], forkL = [[228, 330], [194, 321]]
  const mitL = mitten()
  const strokes = [
    { pts: circStroke(410, 700, 165) }, { pts: circStroke(410, 420, 118) }, { pts: circStroke(410, 222, 85) },
    { pts: armL }, { pts: forkL }, { pts: mir(armL) }, { pts: mir(forkL) },
    { pts: mitL }, { pts: mir(mitL) },
    { pts: nose }, { pts: quad([378, 266], [410, 292], [442, 266]) },
    { pts: [...crownZig, ...crownBase.slice(1)] },
    { pts: band }, { pts: [...tail] },
    { pts: wavy(flame(24, 922, 314, 256), 16, 14), w: 11, col: '#0EA5E9', aura: true },
    { pts: wavy(flame(60, 888, 282, 224), 11, 14), w: 7, col: '#38BDF8', aura: true },
  ]
  const fills = [
    { pts: crescent(410, 222, 85), col: '#C9DCEE' }, { pts: crescent(410, 420, 118), col: '#C9DCEE' }, { pts: crescent(410, 700, 165), col: '#C9DCEE' },
    { pts: mitL, col: '#14B8A6' }, { pts: mir(mitL), col: '#14B8A6' }, { pts: nose, col: '#F97316' },
    { pts: [...crownZig, ...crownBase.slice(1)], col: '#7DD3FC' }, { pts: band, col: '#E5383B' }, { pts: tail, col: '#E5383B' },
  ]
  const dots = [[382, 212, 8], [438, 212, 8], [410, 372, 10], [410, 430, 10], [410, 488, 10]]
  return { strokes, fills, dots }
}

// Ribbon strokes in one geometry: attribute aS = when that bit of ink appears (0…1 over the whole drawing).
// A fragment shows when aS ≤ uP, so uP draws every stroke on in order, as a kid would.
function buildInk(strokes, toLocal, z) {
  const pos = [], sv = [], cv = [], idx = [], windows = []
  const weights = strokes.map(s => { let L = 0; for (let i = 1; i < s.pts.length; i++) L += Math.hypot(s.pts[i][0] - s.pts[i - 1][0], s.pts[i][1] - s.pts[i - 1][1]); s.L = L; return Math.pow(L, 0.8) + 40 })
  const total = weights.reduce((a, b) => a + b, 0)
  let t = 0
  for (const [k, s] of strokes.entries()) {
    const a = t / total, b = (t + weights[k] - 40 * 0.8) / total; t += weights[k]
    // resample every 2.5 px
    const src = s.pts, cum = [0]; for (let i = 1; i < src.length; i++) cum.push(cum[i - 1] + Math.hypot(src[i][0] - src[i - 1][0], src[i][1] - src[i - 1][1]))
    const L = cum[cum.length - 1], n = Math.max(2, Math.ceil(L / 2.5)), P = []
    for (let i = 0, j = 1; i <= n; i++) { const l = L * i / n; while (j < src.length - 1 && cum[j] < l) j++; const u = (l - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1); P.push([lerp(src[j - 1][0], src[j][0], u), lerp(src[j - 1][1], src[j][1], u), l]) }
    const w0 = s.w || 9, col = lin(s.col || INK).multiplyScalar(s.glow || 1), base = pos.length / 3
    for (let i = 0; i < P.length; i++) {
      const p = P[i], q0 = P[Math.max(0, i - 1)], q1 = P[Math.min(P.length - 1, i + 1)]
      let tx = q1[0] - q0[0], ty = q1[1] - q0[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl
      const l = p[2], taper = Math.min(1, (l + 2) / 12) * Math.min(1, (L - l + 2) / 16) * (0.9 + 0.14 * Math.sin(Math.PI * l / L))
      const hw = 0.5 * w0 * Math.max(0.35, taper)
      for (const sg of [1, -1]) { const v = toLocal(p[0] - ty * hw * sg, p[1] + tx * hw * sg); pos.push(v[0], v[1], z); sv.push(lerp(a, b, l / L)); cv.push(col.r, col.g, col.b) }
      if (i < P.length - 1) { const o = base + 2 * i; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2) }
    }
    windows.push({ a, b, P, L, col: s.col || INK, aura: !!s.aura })
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aS', new THREE.Float32BufferAttribute(sv, 1))
  g.setAttribute('aC', new THREE.Float32BufferAttribute(cv, 3))
  g.setIndex(idx)
  const mat = new THREE.ShaderMaterial({
    uniforms: { uP: { value: 0 } }, side: THREE.DoubleSide,
    vertexShader: 'attribute float aS; attribute vec3 aC; varying float vS; varying vec3 vC; void main(){ vS = aS; vC = aC; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uP; varying float vS; varying vec3 vC; void main(){ if (vS > uP) discard; gl_FragColor = vec4(vC, 1.0); }',
  })
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false
  return { mesh, mat, windows }
}

// ───────────────────────── paper snowflakes ─────────────────────────
// One 30° wedge (fold lines at 0° = arm centre and 30° = between arms), cut like folded paper; 12 copies, every other one
// flipped over its fold, make a 6-armed snowflake. Unfolding = flip the odd wedges open, then fan everything out.
function wedgeShape() {
  const P = [[0, 0], [0.16, 0], [0.22, 0.045], [0.28, 0], [0.5, 0], [0.58, 0.05], [0.66, 0], [1.0, 0], [0.93, 0.05], [0.8, 0.05], [0.92, 0.19],
    [0.86, 0.225], [0.71, 0.072], [0.6, 0.075], [0.71, 0.27], [0.64, 0.3], [0.49, 0.09], [0.41, 0.1], [0.43, 0.248], [0.33, 0.19], [0.3, 0.105], [0.23, 0.133], [0.13, 0.075]]
  return new THREE.Shape(P.map(([x, y]) => new THREE.Vector2(x, y)))
}
function makeFlake(geo, color, seed) {
  const group = new THREE.Group(), body = new THREE.Group(); group.add(body)
  const mat = new THREE.MeshStandardMaterial({ color: lin(color), roughness: 0.82, metalness: 0, side: THREE.DoubleSide, emissive: lin(color), emissiveIntensity: 0.22 })
  const axis = new THREE.Vector3(Math.cos(30 * DEG), Math.sin(30 * DEG), 0), parts = []
  for (let k = 0; k < 12; k++) {
    const outer = new THREE.Object3D(), inner = new THREE.Object3D(), m = new THREE.Mesh(geo, mat)
    m.castShadow = true; inner.add(m); outer.add(inner); body.add(outer); parts.push({ k, outer, inner, m })
  }
  const q = new THREE.Quaternion()
  return {
    group, body, mat, seed,
    unfold(u) {
      for (const { k, outer, inner, m } of parts) {
        const d = (k % 6) * 0.03, f = eio(ramp(u, 0.02 + d, 0.5 + d)), s = eio(ramp(u, 0.38 + d, 0.92 + d * 0.5))
        if (k % 2 === 0) { outer.rotation.z = k * 30 * DEG * s; inner.quaternion.identity() }
        else { outer.rotation.z = (k - 1) * 30 * DEG * s; inner.quaternion.copy(q.setFromAxisAngle(axis, Math.PI * f)) }
        m.position.z = (k - 6) * 0.006 * (1 - s)
      }
    },
  }
}

// ───────────────────────── the logo mark in 3D ─────────────────────────
function buildMark() {
  const S = 1.55 / 240, root = new THREE.Group(), mark = new THREE.Group(); root.add(mark)
  const V = ([x, y]) => new THREE.Vector2((x - 120) * S, (120 - y) * S)
  const shape = (outline, holes = []) => {
    const o = outline.map(V), cw = THREE.ShapeUtils.isClockWise(o), s = new THREE.Shape(o)
    for (const h of holes) { const hv = h.map(V); s.holes.push(new THREE.Path(THREE.ShapeUtils.isClockWise(hv) === cw ? hv.reverse() : hv)) }
    return s
  }
  const ext = (sh, depth, bevel) => { const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.75, bevelSegments: 3, curveSegments: 4 }); g.translate(0, 0, -depth / 2); return g }
  const blue = new THREE.MeshPhysicalMaterial({ color: lin('#1f86f5'), metalness: 0.2, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.06, emissive: lin('#0b5fc4'), emissiveIntensity: 0.55 })
  const checkMat = new THREE.MeshPhysicalMaterial({ color: lin('#2a8fff'), metalness: 0.2, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.05, emissive: lin('#0b5fc4'), emissiveIntensity: 0.7 })
  const white = new THREE.MeshPhysicalMaterial({ color: lin('#eef2f7'), metalness: 0.05, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.08, emissive: lin('#ffffff'), emissiveIntensity: 0.12 })
  const cutPlane = new THREE.Plane(), cutLocal = new THREE.Plane()
  const whiteClip = white.clone(); whiteClip.clippingPlanes = [cutPlane]; whiteClip.side = THREE.DoubleSide
  // parts (each in its own pivot so it can fly in)
  const part = (geo, mat, x = 0, y = 0, z = 0) => { const pivot = new THREE.Group(), m = new THREE.Mesh(geo, mat); pivot.position.set(x, y, z); pivot.add(m); mark.add(pivot); m.castShadow = true; return { pivot, m } }
  const ring = part(ext(shape(ringOutline()), 0.05, 0.012), blue, 0, 0, -0.02)
  const g = MARK.gear, bg = MARK.bigGear
  const gearAt = G => V([G.cx, G.cy])
  const gearGeo = G => { const sh = new THREE.Shape(gearOutline(G).map(([x, y]) => new THREE.Vector2(x * S, -y * S))); if (G.hole) { const h = circle(G.hole).map(([x, y]) => new THREE.Vector2(x * S, -y * S)); sh.holes.push(new THREE.Path(THREE.ShapeUtils.isClockWise(h) === THREE.ShapeUtils.isClockWise(sh.getPoints()) ? h.reverse() : h)) } return sh }
  const gc = gearAt(g), bc = gearAt(bg)
  const gear = part(ext(gearGeo(g), 0.045, 0.01), white, gc.x, gc.y, -0.01)
  const big = part(ext(gearGeo(bg), 0.04, 0.01), whiteClip, bc.x, bc.y, -0.06)
  const check = part(ext(shape(MARK.check), 0.07, 0.014), checkMat, 0, 0, 0.035)
  const bases = MARK.base.map((r, i) => part(ext(shape(roundRect(r)), 0.04, 0.008), blue, 0, 0, -0.01 - i * 0.002))
  const dotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(5) })
  const dv = V([MARK.dot.cx, MARK.dot.cy]), dot = part(new THREE.SphereGeometry(MARK.dot.r * S * 1.15, 20, 14), dotMat, dv.x, dv.y, 0.03)
  // halo: a soft additive glow behind the mark
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uK: { value: 0 }, uC: { value: lin('#1f6fe0') } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uK; uniform vec3 uC; varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - d), 2.2) * uK; gl_FragColor = vec4(uC * a, a); }',
  }))
  halo.userData.glow = 'self'; halo.position.z = -0.4; root.add(halo)
  // the gap line along the check's long arm (local plane, updated to world space each frame)
  const { p, d, gap } = MARK.cut, L = Math.hypot(d[0], d[1]), n2 = [-d[1] / L, d[0] / L]
  const q = V([p[0] + n2[0] * gap, p[1] + n2[1] * gap]), n3 = new THREE.Vector3(n2[0], -n2[1], 0).normalize()
  cutLocal.setFromNormalAndCoplanarPoint(n3, new THREE.Vector3(q.x, q.y, 0))
  const checkDir = new THREE.Vector2(d[0], -d[1]).normalize()
  return {
    root, mark, halo,
    // k: assembly 0→1; spin: gear angle (rad); tilt: [x, y] radians toward the pointer
    set(k, spin, tilt) {
      const a = (t0, t1) => ramp(k, t0, t1)
      const r = back(a(0.0, 0.45)); ring.pivot.scale.setScalar(Math.max(0.001, r)); ring.pivot.rotation.z = -1.2 * (1 - eo(a(0, 0.45)))
      const c = eo(a(0.18, 0.62)); check.pivot.position.set(-checkDir.x * 1.6 * (1 - c), -checkDir.y * 1.6 * (1 - c), 0.035 + 0.6 * (1 - c)); check.pivot.visible = c > 0.001
      const gk = back(a(0.3, 0.75)); gear.pivot.scale.setScalar(Math.max(0.001, gk)); gear.m.rotation.z = spin - 2.4 * (1 - eo(a(0.3, 0.9)))
      const bk = eo(a(0.4, 0.85)); big.pivot.scale.setScalar(Math.max(0.001, bk)); big.m.rotation.z = -spin * (g.teeth / bg.teeth) + 0.13 + 1.6 * (1 - eo(a(0.4, 0.95)))
      bases.forEach((b, i) => { const e = eo(a(0.5 + i * 0.08, 0.8 + i * 0.08)); b.pivot.position.y = -0.5 * (1 - e); b.pivot.visible = e > 0.001 })
      const dk = back(a(0.78, 1)); dot.pivot.scale.setScalar(Math.max(0.001, dk)); dot.pivot.visible = dk > 0.001
      halo.material.uniforms.uK.value = 0.18 * eo(a(0.2, 1))
      mark.rotation.set(tilt[0], tilt[1], 0)
      root.updateMatrixWorld(true)
      cutPlane.copy(cutLocal).applyMatrix4(mark.matrixWorld)
    },
  }
}

// ───────────────────────── the story ─────────────────────────
// sync: build and compile without timers (stills capture runs under the studio's virtual clock, where timers wait)
export async function createStory({ canvas, width, height, dpr = 1, layout = 'page', onStep = () => {}, sync = false }) {
  const t0 = performance.now()
  const idle = sync ? () => Promise.resolve() : () => new Promise(r => setTimeout(r, 0)) // yield between build steps so the page stays responsive
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: layout !== 'page' })
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.localClippingEnabled = true
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.05, 120)
  const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 4 })
  const composer = new EffectComposer(renderer, rt)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.36, 1.35)
  composer.addPass(bloom)
  // clamp what feeds the bloom (max channel ≤ 2.6): tiny specular glints stay tiny, broad emissive parts still glow
  { const hp = bloom.materialHighPassFilter, a = 'vec4 texel = texture2D( tDiffuse, vUv );'
    if (hp.fragmentShader.includes(a)) { hp.fragmentShader = hp.fragmentShader.replace(a, a + ' texel.rgb *= min(1.0, 2.6 / max(max(texel.r, max(texel.g, texel.b)), 1e-4));'); hp.needsUpdate = true } }
  composer.addPass(new OutputPass())

  // stage, car, engine
  const stage = makeStage(scene, { R: null })
  stage.lights.key.shadow.mapSize.set(1024, 1024)
  stage.setEnvironment(studioEnvironment(renderer))
  onStep('stage'); await idle()
  const car = makeCar({ paint: 0x173a6a })
  scene.add(car.group)
  const blob = contactShadow(5.0, 2.3, 0.8); car.group.add(blob)
  onStep('car'); await idle()
  const engine = makeEngine({ look: 'xray' })
  engine.group.scale.setScalar(0.12); car.engineSlot.add(engine.group)
  engine.setXrayTint(COLORS.amber, 1.3)
  onStep('engine'); await idle()

  // paper + drawing (a sheet group whose XY plane is the paper; local z = up)
  const PAPER_S = 1 / 400
  const paperRoot = new THREE.Group(); scene.add(paperRoot)
  const sheet = new THREE.Group(); sheet.rotation.x = -Math.PI / 2; paperRoot.add(sheet)
  // matte paper: no environment reflection (no hot spot), lit by the key light so the marker casts a shadow on it
  const paperMat = new THREE.MeshStandardMaterial({ color: lin('#fffdf8'), roughness: 1, metalness: 0, envMapIntensity: 0, emissive: lin('#fffaf0'), emissiveIntensity: 0.34, side: THREE.DoubleSide })
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(820 * PAPER_S, 960 * PAPER_S), paperMat)
  paper.castShadow = true; paper.receiveShadow = true; sheet.add(paper)
  const paperBlob = contactShadow(2.7, 3.0, 0.65); paperBlob.rotation.x = 0; paperBlob.position.z = -0.002; sheet.add(paperBlob)
  const toLocal = (px, py) => [(px - 410) * PAPER_S, -(py - 480) * PAPER_S]
  const hero = heroDrawing()
  const ink = buildInk(hero.strokes, toLocal, 0.0016); sheet.add(ink.mesh)
  const fills = hero.fills.map(f => {
    const sh = new THREE.Shape(f.pts.map(([x, y]) => new THREE.Vector2(...toLocal(x, y))))
    const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshStandardMaterial({ color: lin(f.col), roughness: 1, metalness: 0, envMapIntensity: 0, emissive: lin(f.col), emissiveIntensity: 0.34, transparent: true, opacity: 0, depthWrite: false }))
    m.position.z = 0.0008; m.receiveShadow = true; sheet.add(m); return m
  })
  const dotGeo = new THREE.CircleGeometry(1, 20), dotMat = new THREE.MeshBasicMaterial({ color: lin(INK) })
  const dots = hero.dots.map(([x, y, r]) => { const m = new THREE.Mesh(dotGeo, dotMat); const v = toLocal(x, y); m.position.set(v[0], v[1], 0.0018); m.userData.r = r * PAPER_S; m.scale.setScalar(0.0001); sheet.add(m); return m })
  // a 3D marker that rides the stroke tip
  const marker = new THREE.Group(), markerTilt = new THREE.Group(); marker.add(markerTilt); sheet.add(marker)
  const tipMat = new THREE.MeshStandardMaterial({ color: lin(INK), roughness: 0.5 })
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: lin('#1f86f5'), roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 })
  const capMat = new THREE.MeshStandardMaterial({ color: lin('#f4f6f9'), roughness: 0.4 })
  { const c = (r0, r1, h, m, y) => { const g = new THREE.CylinderGeometry(r0, r1, h, 24); const mesh = new THREE.Mesh(g, m); mesh.position.y = y; mesh.castShadow = true; markerTilt.add(mesh) }
    c(0.011, 0.003, 0.03, tipMat, 0.015); c(0.024, 0.013, 0.03, capMat, 0.045); c(0.026, 0.026, 0.33, bodyMat, 0.225); c(0.027, 0.027, 0.03, capMat, 0.405); c(0.02, 0.026, 0.02, bodyMat, 0.43) }
  markerTilt.rotation.set(Math.PI / 2 - 0.62, 0, -0.5) // lean toward the viewer's right, like a right hand holds it
  onStep('drawing'); await idle()

  // snowflakes
  const wedge = new THREE.ShapeGeometry(wedgeShape(), 1)
  const R = rng(hashSeed('site-flakes'))
  const FLAKES = [
    { c: '#ffffff', s: 0.62, from: [-1.55, 0.05, 0.2], to: [-0.45, 1.72, -2.6] },
    { c: '#7DD3FC', s: 0.34, from: [1.5, 0.05, -0.7], to: [0.75, 2.25, -2.9] },
    { c: '#FFB020', s: 0.3, from: [1.45, 0.05, 0.85], to: [0.95, 1.25, -2.4] },
    { c: '#2DD4BF', s: 0.26, from: [-1.4, 0.05, -1.0], to: [-1.25, 2.35, -3.1] },
    { c: '#BAE6FD', s: 0.22, from: [-1.35, 0.05, 1.1], to: [-1.3, 1.15, -2.3] },
    { c: '#ffffff', s: 0.2, from: [1.25, 0.05, -1.45], to: [1.45, 1.85, -3.2] },
  ].map((f, i) => { const fl = makeFlake(wedge, f.c, i); fl.group.scale.setScalar(f.s); scene.add(fl.group); return { ...f, fl, ph: R() * 6.28, sp: (R() < 0.5 ? -1 : 1) * (0.12 + 0.12 * R()), bx: (R() - 0.5) * 7.5, by: 0.4 + 2.9 * R(), bz: -5.5 - 2 * R() } })
  // backdrop spots for act 4 (spread around the mark)
  const SPOTS = [[-1.05, 2.95, -5.6], [1.85, 2.8, -5.8], [-0.95, 0.5, -5.4], [2.0, 1.05, -5.2], [0.45, 3.35, -6.4], [1.35, 0.1, -6.0]]
  onStep('flakes'); await idle()

  const markObj = buildMark(); markObj.root.position.set(0, 1.75, -3.2); scene.add(markObj.root)
  onStep('mark'); await idle()

  // ───── per-frame state (a pure function of T, clock, pointer and intro) ─────
  let W = 2, H = 2, DPR = dpr, area = safeArea(16, 9, layout)
  const vTmp = new THREE.Vector3()
  function resize(w, h, pr = DPR) {
    W = Math.max(2, Math.round(w)); H = Math.max(2, Math.round(h)); DPR = pr
    renderer.setPixelRatio(DPR); renderer.setSize(W, H, false)
    composer.setPixelRatio(DPR); composer.setSize(W, H)
    area = safeArea(W, H, layout)
  }
  function placeCamera(T, px, py) {
    const c = camAt(T)
    c.az += px * 4.5; c.el += -py * 2.6
    const aspect = W / H, tv = Math.tan(c.fov * DEG / 2), ws = area.x1 - area.x0, hs = area.y1 - area.y0
    const r = 1.08 * Math.max(c.sh / (2 * tv * hs), c.sw / (2 * tv * aspect * ws))
    const az = c.az * DEG, el = c.el * DEG
    camera.position.set(c.tx + r * Math.cos(el) * Math.sin(az), c.ty + r * Math.sin(el), c.tz + r * Math.cos(el) * Math.cos(az))
    camera.up.set(0, 1, 0); camera.lookAt(c.tx, c.ty, c.tz)
    camera.fov = c.fov; camera.aspect = aspect
    const cx = (area.x0 + area.x1) / 2, cy = (area.y0 + area.y1) / 2
    camera.setViewOffset(W, H, -(cx - 0.5) * W, -(cy - 0.5) * H, W, H)
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true)
  }

  function update(T, clock, { px = 0, py = 0, intro = 1 } = {}) {
    // ---- act 0–1: the car ----
    const carOn = T < 1.62
    car.group.visible = carOn
    if (carOn) {
      const inX = lerp(-7.5, 0, eo(intro)), off = 9.5 * ein(ramp(T, 1.08, 1.55)), x = inX + off
      car.group.position.set(x, 0, 0)
      const wipe = lerp(2.7, -2.8, eio(ramp(T, 0.22, 0.9)))
      const scan = ramp(T, 0.2, 0.3) * (1 - ramp(T, 0.88, 1.0))
      car.update({ dist: x + 7.5, wipe, scanGlow: scan, drl: 0.42, brake: 0 })
      const xr = ramp(T, 0.45, 0.85)
      engine.setXrayTint(COLORS.amber, 0.6 + 0.9 * xr)
      engine.update(clock * 240 + T * 300, { glow: { cyl: 'all', k: xr }, flows: xr, camera, viewH: H * DPR })
    }
    // ---- act 1–2: paper lands, the hero draws itself ----
    const paperOn = T > 1.12 && T < 3.05
    paperRoot.visible = paperOn
    if (paperOn) {
      const u = ramp(T, 1.2, 1.6), fall = 1 - eo(u)
      const sink = ein(ramp(T, 2.45, 2.95))   // drops away into the dark once we look up at the snowflakes
      paperRoot.position.set(0.35 * Math.sin(u * 5) * fall, 0.002 + 2.8 * fall - 2.2 * sink, -0.25 * fall + 0.6 * sink)
      paperRoot.rotation.set(0.75 * fall * Math.sin(u * 8.5), -6 * DEG + 0.5 * fall, 0.45 * fall * Math.cos(u * 7))
      paperBlob.material.opacity = 0.65 * eo(ramp(u, 0.7, 1))
      const P = ramp(T, 1.6, 1.96)
      ink.mat.uniforms.uP.value = P
      const fk = ramp(T, 1.84, 2.0)
      fills.forEach((m, i) => { m.material.opacity = eo(ramp(fk, i * 0.06, 0.4 + i * 0.06)) })
      dots.forEach((m, i) => { const at = i < 2 ? 1.79 + i * 0.008 : 1.86 + (i - 2) * 0.01, k = back(ramp(T, at, at + 0.03)); m.scale.setScalar(Math.max(0.0001, k * m.userData.r)) })
      // marker on the tip
      const wins = ink.windows
      let tip = null, lift = 0
      for (let i = 0; i < wins.length; i++) {
        const w = wins[i]
        if (P >= w.a && P <= w.b) { const l = w.L * (P - w.a) / (w.b - w.a); tip = pointAt(w, l); tipMat.color.copy(lin(w.col)); break }
        const nx = wins[i + 1]
        if (nx && P > w.b && P < nx.a) { const k = (P - w.b) / (nx.a - w.b), A = pointAt(w, w.L), B = pointAt(nx, 0); tip = [lerp(A[0], B[0], eio(k)), lerp(A[1], B[1], eio(k))]; lift = Math.sin(Math.PI * k) * 0.06; break }
      }
      if (!tip) { const last = wins[wins.length - 1], first = wins[0]; tip = P <= first.a ? pointAt(first, 0) : pointAt(last, last.L); lift = P <= first.a ? 0.25 * (1 - ramp(T, 1.52, 1.6)) : 0.3 * ramp(T, 1.96, 2.06) }
      const mv = toLocal(tip[0], tip[1]), show = ramp(T, 1.54, 1.6) * (1 - ramp(T, 2.0, 2.08))
      marker.visible = show > 0.01
      marker.position.set(mv[0], mv[1], 0.002 + lift)
      marker.scale.setScalar(Math.max(0.001, show))
    }
    // ---- act 2–3: snowflakes unfold; act 3–4: they drift back around the mark ----
    const flakesOn = T > 2.15
    for (const [i, f] of FLAKES.entries()) {
      f.fl.group.visible = flakesOn
      if (!flakesOn) continue
      const d = i * 0.045, u = ramp(T, 2.2 + d * 0.8, 2.82 + d * 0.4), e = eio(u)
      f.fl.group.visible = u > 0.02
      const back4 = eio(ramp(T, 3.25, 3.85))
      const fx = lerp(f.from[0], f.to[0], e), fy = lerp(f.from[1], f.to[1], e) + Math.sin(u * Math.PI) * 0.35, fz = lerp(f.from[2], f.to[2], e)
      const bob = 0.05 * Math.sin(clock * 0.9 + f.ph) * e
      const S2 = SPOTS[i]
      f.fl.group.position.set(lerp(fx, S2[0], back4), lerp(fy + bob, S2[1] + bob, back4), lerp(fz, S2[2], back4))
      f.fl.group.rotation.set(lerp(-Math.PI / 2, 0.12 * Math.sin(clock * 0.5 + f.ph), e), 0.25 * Math.sin(clock * 0.4 + f.ph) * e, f.ph * (1 - e) + clock * f.sp + T * 0.4 * Math.sign(f.sp))
      f.fl.unfold(u)
      f.fl.group.scale.setScalar(f.s * (0.25 + 0.75 * eo(ramp(u, 0, 0.35))) * (1 - 0.45 * back4))
      f.fl.mat.emissiveIntensity = 0.22 * (1 - 0.7 * back4)
    }
    // ---- act 3–4: the mark ----
    const mk = ramp(T, 3.28, 3.92)
    markObj.root.visible = mk > 0
    if (mk > 0) { markObj.root.position.y = 1.75 + 0.025 * Math.sin(clock * 1.1); markObj.set(mk, clock * 0.55 + T * 1.2, [-py * 0.22 + 0.02 * Math.sin(clock * 0.7), px * 0.38 + 0.04 * Math.sin(clock * 0.5)]) }
    // ---- stage: the floor fades away when we look up into the air ----
    const air = ramp(T, 2.4, 2.9)
    const p = stage.preset(STAGE.studio, STAGE.studio, 0)
    p.floor = 0.75 * (1 - air); p.shadow = 0.55 * (1 - air); p.pool = 1 - air
    p.rimA = 26   // softer rear rim light: its clear-coat glint read like a lamp on the web
    stage.set(p, [0, 0])
    blob.visible = carOn
    // bloom only what emits: high threshold over the glossy car and the white paper, lower for the glowing mark
    bloom.threshold = T < 1.3 ? 1.7 : T < 2.5 ? 1.9 : lerp(1.7, 1.2, ramp(T, 3.3, 3.9))
    bloom.strength = lerp(0.5, 0.7, ramp(T, 3.3, 4))
    placeCamera(T, px, py)
  }
  const pointAt = (w, l) => { const P = w.P; let i = Math.min(P.length - 1, Math.max(0, Math.round(l / w.L * (P.length - 1)))); return P[i] }

  function render(T, clock, opts) { update(T, clock, opts); composer.render() }
  // warm up: compile every material once, with everything visible
  resize(width || canvas.clientWidth || 1280, height || canvas.clientHeight || 720, dpr)
  for (const o of [car.group, paperRoot, markObj.root, ...FLAKES.map(f => f.fl.group)]) o.visible = true
  placeCamera(0, 0, 0)
  if (sync) renderer.compile(scene, camera); else { try { await renderer.compileAsync(scene, camera) } catch { renderer.compile(scene, camera) } }
  onStep('compiled')
  const buildMs = performance.now() - t0
  return { renderer, scene, camera, composer, bloom, render, update, resize, get size() { return { W, H, DPR } }, buildMs }
}

// ───────────────────────── page controller ─────────────────────────
// chapters: elements in story order (chapter k centred ⇒ T = k). Starts paused until mount() resolves.
export async function mount({ canvas, chapters, cover = null, onReady = () => {} }) {
  const coarse = matchMedia('(pointer: coarse)').matches
  const cap = () => (coarse || innerWidth < 760) ? 1.25 : 1.75
  let quality = 1
  const pr = () => Math.max(0.75, Math.min(devicePixelRatio || 1, cap()) * quality)
  const size = () => [canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight]
  const steps = [], tb = performance.now()
  const story = await createStory({ canvas, width: size()[0], height: size()[1], dpr: pr(), onStep: s => steps.push(s + ' ' + Math.round(performance.now() - tb)) })
  // chapter k fills the viewport (its top at the viewport top) ⇒ T = k; in between T is linear in the scroll position
  let anchors = []
  const measure = () => { anchors = chapters.map(el => el.getBoundingClientRect().top + scrollY); if (cover) coverTop = cover.getBoundingClientRect().top + scrollY + 110 }
  const target = () => {
    const c = scrollY
    if (!anchors.length || c <= anchors[0]) return 0
    for (let i = 0; i < anchors.length - 1; i++) if (c < anchors[i + 1]) return i + (c - anchors[i]) / Math.max(1, anchors[i + 1] - anchors[i])
    return anchors.length - 1
  }
  // after the last chapter the next section (opaque) slides over the canvas; once it covers the viewport we stop rendering
  let coverTop = Infinity
  const fadeOut = () => (scrollY >= coverTop ? 1 : 0)
  measure()
  let T = target(), px = 0, py = 0, tx = 0, ty = 0, clock = 0, intro = T > 0.4 ? 1 : 0, last = performance.now(), raf = 0, visible = true, inView = true
  const frames = [], cpu = []
  let lastW = 0, lastH = 0
  const doResize = () => { const [w, h] = size(); if (Math.abs(w - lastW) < 1 && Math.abs(h - lastH) < 1) return; lastW = w; lastH = h; story.resize(w, h, pr()); measure() }
  doResize()
  const frame = now => {
    raf = 0
    const dt = Math.min(0.1, (now - last) / 1000); last = now; lastFrameAt = performance.now()
    frames.push(dt * 1000); if (frames.length > 120) frames.shift()
    clock += dt; intro = Math.min(1, intro + dt / 1.9)
    const goal = target(), k = 1 - Math.exp(-dt * 5.5)
    T += (goal - T) * k; if (Math.abs(goal - T) < 1e-4) T = goal
    px += (tx - px) * (1 - Math.exp(-dt * 4)); py += (ty - py) * (1 - Math.exp(-dt * 4))
    const fo = fadeOut()
    canvas.style.visibility = fo >= 1 ? 'hidden' : 'visible'
    const s0 = performance.now()
    if (fo < 0.999) story.render(T, clock, { px, py, intro })
    cpu.push(performance.now() - s0); if (cpu.length > 120) cpu.shift()
    // slow device: lower the resolution in steps (never back up, so it can't oscillate)
    if (frames.length === 120 && quality > 0.6) { const m = [...frames].sort((a, b) => a - b)[60]; if (m > 26) { quality -= 0.15; story.resize(...size(), pr()); frames.length = 0 } }
    schedule()
  }
  const active = () => visible && inView && fadeOut() < 0.999
  function schedule() { if (!raf && active()) raf = requestAnimationFrame(frame) }
  // after a pause (covered, hidden tab) jump straight to the scroll position instead of fast-forwarding through the story
  let lastFrameAt = 0
  const wake = () => { const now = performance.now(); if (!raf && now - lastFrameAt > 250) T = target(); last = now; schedule() }
  addEventListener('scroll', () => { if (!raf) wake() }, { passive: true })
  addEventListener('resize', () => { doResize(); wake() })
  addEventListener('pointermove', e => { tx = (e.clientX / innerWidth) * 2 - 1; ty = (e.clientY / innerHeight) * 2 - 1 }, { passive: true })
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; if (visible) wake() })
  const io = new IntersectionObserver(es => { for (const e of es) inView = e.isIntersecting; if (inView) wake() }, { rootMargin: '0px 0px 30% 0px' })
  const storyEl = chapters[0].parentElement; io.observe(storyEl)
  new ResizeObserver(() => measure()).observe(document.body)
  // first frame, then fade the canvas in
  story.render(T, 0, { px: 0, py: 0, intro })
  onReady(story)
  schedule()
  const med = a => a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : null
  window.__story = { stats: () => ({ T: +T.toFixed(3), running: !!raf, quality, dpr: story.size.DPR, size: [story.size.W, story.size.H], buildMs: Math.round(story.buildMs), steps, frameMs: med(frames), renderCpuMs: med(cpu) }) }
  return story
}
