// scene3d.js — adapted for the website (spec 0006) from the EasyTips Studio 3D kit
// (easytips-studio/templates/explainer-3d/scene3d.js, skills/scene-3d/SKILL.md). Same car, engine, stage and materials.
// Website changes: no SMAA/overlay/camera-rig/RoomEnvironment (the story drives its own camera and renderer, see story.js),
// no planar floor reflection unless a renderer bundle is passed, and particle sizes take the drawing-buffer height.
// Needs det.js (rng, hashSeed) loaded first. Pure functions of the values passed per frame.
import * as THREE from 'three'

export { THREE }
export const W = 1920, H = 1080
export const GLOW = 5 // emissive intensity of parts that should bloom (LEDs use 12)
export const DEG = Math.PI / 180
export const COLORS = { bg: '#0d1117', ink: '#F5F7FA', sub: '#AEB7C4', good: '#2DD4BF', bad: '#F87171', amber: '#FFB020', brand: '#0585ED' }
// Flow colour code (How Cars Work series): blue = electricity, orange = fuel, red = heat, teal = air (+ grey exhaust)
export const FLOW = { electricity: '#4DA3FF', fuel: '#FF7A1A', heat: '#FF3B30', air: '#5EEAD4', exhaust: '#9AA4B2' }

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x))
const lerp = (a, b, p) => a + (b - a) * p
const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k) }
const fract = x => x - Math.floor(x)
const mod = (a, n) => ((a % n) + n) % n
const lin = hex => new THREE.Color(hex) // THREE.Color converts sRGB hex to linear working space
export const util = { clamp, lerp, smooth, fract, mod }

// ───────────────────────────── environment (reflections) ─────────────────────────────
// Procedural car-studio environment: a dark room with long softbox strips, so clear-coat paint shows crisp
// highlight lines. No HDRI file. roomEnvironment() is the stock three.js alternative (softer, busier).
export function studioEnvironment(renderer, { strength = 1 } = {}) {
  const env = new THREE.Scene()
  env.add(new THREE.Mesh(new THREE.SphereGeometry(40, 48, 24), new THREE.MeshBasicMaterial({ color: lin(0x07090c), side: THREE.BackSide })))
  const panel = (w, h, pos, k, col = 0xffffff) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: lin(col).multiplyScalar(k * strength), side: THREE.DoubleSide }))
    m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m)
  }
  panel(16, 7, [0, 14, 0], 1.5)                 // overhead softbox → roof/hood/bonnet gradient
  panel(26, 0.9, [0, 3.2, 11], 2.6)             // long side strips → the classic horizontal paint highlight
  panel(26, 0.9, [0, 3.2, -11], 2.6)
  panel(26, 0.35, [0, 7.5, 9], 1.8, 0xdfe9ff)   // thin upper strips (shoulder line)
  panel(26, 0.35, [0, 7.5, -9], 1.8, 0xdfe9ff)
  panel(26, 0.5, [0, 0.6, 10], 0.9, 0xcfe0ff)   // low strips → a second line along the sills
  panel(26, 0.5, [0, 0.6, -10], 0.9, 0xcfe0ff)
  panel(1.2, 7, [12, 3.5, 3], 1.4)              // front verticals
  panel(1.2, 7, [-12, 3.5, -3], 1.4)
  panel(40, 40, [0, -7, 0], 0.16, 0x9fb3c8)     // faint floor bounce
  const pmrem = new THREE.PMREMGenerator(renderer)
  const tex = pmrem.fromScene(env, 0.015).texture
  pmrem.dispose()
  return tex
}

// ───────────────────────────── stage: floor, shadows, lights ─────────────────────────────
// One stage for both looks. stage.set({ grid, pool, … }) every frame (values from t), or stage.preset(a, b, k).
// studio: dark floor with a soft light pool, no grid. blueprint: blue engineering grid (How Cars Work).
export const STAGE = {
  studio: { grid: 0, pool: 1, poolR: 4.2, floor: 0.75, key: 2.6, hemi: 0.25, rimA: 70, rimB: 45, env: 1.0, shadow: 0.55, reflect: 0.32 },
  blueprint: { grid: 1, pool: 0.75, poolR: 5.5, floor: 0.8, key: 1.6, hemi: 0.45, rimA: 40, rimB: 40, env: 0.8, shadow: 0.4, reflect: 0 },
}
// R = createRenderer() result: the stage adds a planar floor reflection pre-pass to it (studio look only).
export function makeStage(scene, { R = null, cell = 0.5, majorEvery = 4, fade = [6.5, 20] } = {}) {
  const group = new THREE.Group(); group.name = 'stage'; scene.add(group)
  const floorMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uBase: { value: lin(0x161e29) }, uMinor: { value: lin(0x2b4a72) }, uMajor: { value: lin(0x4b7fc0) },
      uGrid: { value: 0 }, uPool: { value: 1 }, uPoolR: { value: 4.5 }, uFloor: { value: 0.8 },
      uFade: { value: new THREE.Vector2(...fade) }, uCell: { value: cell }, uMajorEvery: { value: majorEvery }, uCenter: { value: new THREE.Vector2() },
      tRefl: { value: null }, uTexMat: { value: new THREE.Matrix4() }, uRefl: { value: 0 }, uReflR: { value: 4.5 },
    },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform vec3 uBase, uMinor, uMajor; uniform float uGrid, uPool, uPoolR, uFloor, uCell, uMajorEvery; uniform vec2 uFade, uCenter; varying vec3 vW;
      uniform sampler2D tRefl; uniform mat4 uTexMat; uniform float uRefl, uReflR;
      float gridLine(vec2 p, float px){ vec2 d = fwidth(p); vec2 g = abs(fract(p - 0.5) - 0.5) / max(d, vec2(1e-5));
        float l = min(g.x, g.y); float aa = 1.0 - smoothstep(0.35, 0.9, max(d.x, d.y)); return (1.0 - clamp(l / px, 0.0, 1.0)) * aa; }
      void main(){
        vec2 q = vW.xz - uCenter; float d = length(q);
        float fade = 1.0 - smoothstep(uFade.x, uFade.y, d);
        float pool = uPool * (1.0 - smoothstep(0.0, uPoolR, d));
        vec3 col = uBase * (0.55 + 1.1 * pool);
        float a = uFloor * (0.45 + 0.55 * pool) * fade;
        float minor = gridLine(vW.xz / uCell, 1.1);
        float major = gridLine(vW.xz / (uCell * uMajorEvery), 1.6);
        float lf = fade * uGrid * (0.55 + 0.45 * pool);
        col = mix(col, uMinor, minor * 0.85 * lf);
        col = mix(col, uMajor, major * lf);
        a = max(a, (minor * 0.55 + major * 0.9) * lf);
        if (uRefl > 0.0) {   // glossy floor: mirrored render, fading away from the subject
          vec4 pr = uTexMat * vec4(vW, 1.0); vec4 rc = texture2DProj(tRefl, pr);
          float k = uRefl * (1.0 - smoothstep(0.4 * uReflR, uReflR, d)) * rc.a;
          float a2 = clamp(a + k, 0.0, 1.0);
          col = (col * a + rc.rgb * uRefl * (1.0 - smoothstep(0.4 * uReflR, uReflR, d))) / max(a2, 1e-4);
          a = a2;
        }
        gl_FragColor = vec4(col, a);
      }`,
  })
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), floorMat)
  floor.rotation.x = -Math.PI / 2; floor.renderOrder = -3; group.add(floor)
  const shadowMat = new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.55, depthWrite: false })
  const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), shadowMat)
  shadowCatcher.rotation.x = -Math.PI / 2; shadowCatcher.position.y = 0.001; shadowCatcher.receiveShadow = true; shadowCatcher.renderOrder = -2
  group.add(shadowCatcher)

  const hemi = new THREE.HemisphereLight(lin(0xdfe9ff), lin(0x0d1117), 0.3)
  const key = new THREE.DirectionalLight(0xffffff, 2.5)
  key.position.set(-3.5, 10, 5.5); key.castShadow = true
  key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0003; key.shadow.normalBias = 0.02; key.shadow.radius = 3
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 })
  const rimA = new THREE.SpotLight(lin(0xcfe2ff), 60, 40, 0.5, 0.9, 1.6); rimA.position.set(-7, 3.2, -5)
  const rimB = new THREE.SpotLight(lin(0xbcd8ff), 40, 40, 0.5, 0.9, 1.6); rimB.position.set(7, 3.0, -6)
  for (const s of [rimA, rimB]) { s.target.position.set(0, 0.7, 0); group.add(s.target) }
  group.add(hemi, key, key.target, rimA, rimB)

  // planar reflection: the scene seen from the camera mirrored in y = 0, rendered at half resolution (soft)
  const reflRT = R ? new THREE.WebGLRenderTarget(W / 2, H / 2, { type: THREE.HalfFloatType, samples: 4 }) : null
  floorMat.uniforms.tRefl.value = reflRT ? reflRT.texture : null
  const vcam = new THREE.PerspectiveCamera(), _p = new THREE.Vector3(), _d = new THREE.Vector3(), _u = new THREE.Vector3()
  const texBias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
  const hideInRefl = []
  if (R) R.pre.push(() => {
    if (!(floorMat.uniforms.uRefl.value > 0)) return false
    const cam = R.camera
    cam.getWorldPosition(_p); cam.getWorldDirection(_d); _u.set(0, 1, 0).applyQuaternion(cam.quaternion)
    vcam.position.set(_p.x, -_p.y, _p.z); vcam.up.set(_u.x, -_u.y, _u.z)
    vcam.lookAt(_p.x + _d.x, -(_p.y + _d.y), _p.z + _d.z)
    vcam.fov = cam.fov * 1.15; vcam.aspect = W / H; vcam.near = cam.near; vcam.far = cam.far; vcam.updateProjectionMatrix(); vcam.updateMatrixWorld(true)
    floorMat.uniforms.uTexMat.value.copy(texBias).multiply(vcam.projectionMatrix).multiply(vcam.matrixWorldInverse)
    const hide = [floor, shadowCatcher, ...hideInRefl], vis = hide.map(o => o.visible)   // lights stay on
    for (const o of hide) o.visible = false
    R.renderer.setRenderTarget(reflRT); R.renderer.setClearColor(0x000000, 0); R.renderer.clear(); R.renderer.render(scene, vcam); R.renderer.setRenderTarget(null)
    hide.forEach((o, i) => { o.visible = vis[i] })
    return true
  })

  let envMap = null
  const api = {
    group, floor, shadowCatcher, lights: { hemi, key, rimA, rimB },
    setEnvironment(tex) { envMap = tex; scene.environment = tex },
    // p: a STAGE preset (or a mix from preset()); center: where the pool/grid fade is centred (x, z)
    set(p, center = [0, 0]) {
      const u = floorMat.uniforms
      u.uGrid.value = p.grid; u.uPool.value = p.pool; u.uPoolR.value = p.poolR; u.uFloor.value = p.floor
      u.uCenter.value.set(center[0], center[1])
      key.intensity = p.key; hemi.intensity = p.hemi; rimA.intensity = p.rimA; rimB.intensity = p.rimB
      shadowMat.opacity = p.shadow
      u.uRefl.value = R ? (p.reflect ?? 0) : 0
      scene.environmentIntensity = envMap ? p.env : 0
    },
    preset(a, b, k) { const o = {}; for (const n in a) o[n] = lerp(a[n], b[n], clamp(k)); return o },
    // objects that must not appear in the floor reflection (contact shadow blobs, x-ray shells …)
    hideInReflection(...objs) { hideInRefl.push(...objs) },
    // Units: car scenes in metres (cell 0.5 m); engine scenes in decimetres → same numbers read as a finer grid.
    setScale(cellSize, fadeNear, fadeFar) { const u = floorMat.uniforms; u.uCell.value = cellSize; u.uFade.value.set(fadeNear, fadeFar) },
  }
  return api
}

// Soft contact shadow (ambient occlusion blob) under a car or engine: canvas texture, drawn once, deterministic.
export function contactShadow(length, width, opacity = 0.85) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128
  const g = c.getContext('2d')
  for (let i = 0; i < 48; i++) {
    const k = i / 48
    g.fillStyle = 'rgba(0,0,0,0.045)'
    g.beginPath(); g.ellipse(128, 64, 124 * (1 - 0.62 * k), 60 * (1 - 0.62 * k), 0, 0, Math.PI * 2); g.fill()
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.NoColorSpace
  const m = new THREE.Mesh(new THREE.PlaneGeometry(length, width), new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: tex, transparent: true, opacity, depthWrite: false }))
  m.rotation.x = -Math.PI / 2; m.position.y = 0.002; m.renderOrder = -1
  return m
}

// ───────────────────────────── materials ─────────────────────────────
export const MAT = {
  // Deep metallic paint under a mirror clear coat. Darker colours show the studio strips best.
  paint: (color = 0x1b2633) => new THREE.MeshPhysicalMaterial({ color: lin(color), metalness: 0.62, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.025, envMapIntensity: 1.0 }),
  glass: () => new THREE.MeshPhysicalMaterial({ color: lin(0x0e151d), metalness: 0, roughness: 0.02, transparent: true, opacity: 0.8, envMapIntensity: 2.4, depthWrite: true }),
  blackGloss: () => new THREE.MeshPhysicalMaterial({ color: lin(0x06080b), metalness: 0.1, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.1 }),
  satin: () => new THREE.MeshStandardMaterial({ color: lin(0x12161b), metalness: 0.2, roughness: 0.62 }),
  chrome: () => new THREE.MeshStandardMaterial({ color: lin(0xe9eef3), metalness: 1, roughness: 0.1 }),
  rubber: () => new THREE.MeshStandardMaterial({ color: lin(0x1f2125), metalness: 0, roughness: 0.78, envMapIntensity: 0.9 }),
  alloy: () => new THREE.MeshPhysicalMaterial({ color: lin(0xb9c1ca), metalness: 1, roughness: 0.24, clearcoat: 0.5, clearcoatRoughness: 0.1 }),
  alloyDark: () => new THREE.MeshStandardMaterial({ color: lin(0x3a414b), metalness: 0.6, roughness: 0.42 }),
  steel: () => new THREE.MeshStandardMaterial({ color: lin(0xaab3bd), metalness: 0.75, roughness: 0.36 }),
  aluminium: () => new THREE.MeshStandardMaterial({ color: lin(0xc9cfd6), metalness: 1, roughness: 0.3 }),
  interior: () => new THREE.MeshStandardMaterial({ color: lin(0x1d2128), metalness: 0, roughness: 0.75 }),
  emissive: (hex, intensity = GLOW) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: lin(hex), emissiveIntensity: intensity, roughness: 0.4 }),
  // A part that can glow amber when it acts: set .userData.glow(k) per frame (k 0…1).
  active: (base = 0x9aa3ad, { metalness = 1, roughness = 0.3 } = {}) => {
    const m = new THREE.MeshStandardMaterial({ color: lin(base), metalness, roughness, emissive: lin(COLORS.amber), emissiveIntensity: 0 })
    m.userData.glow = k => { m.emissiveIntensity = 0.75 * k; m.color.copy(lin(base)).lerp(lin(COLORS.amber), 0.6 * k) }
    return m
  },
}

// X-ray shell: fresnel rim (bright edges, near-clear faces), no depth write, optional clipping planes.
export function xrayMaterial({ color = 0x7fb4ff, base = 0.035, edge = 0.65, power = 2.2, gain = 1.0, clippingPlanes = null } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, clipping: true,
    clippingPlanes,
    uniforms: { uColor: { value: lin(color) }, uBase: { value: base }, uEdge: { value: edge }, uPow: { value: power }, uGain: { value: gain }, uOpacity: { value: 1 } },
    vertexShader: `#include <clipping_planes_pars_vertex>
      varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `#include <clipping_planes_pars_fragment>
      uniform vec3 uColor; uniform float uBase, uEdge, uPow, uGain, uOpacity; varying vec3 vN; varying vec3 vV;
      void main(){
        #include <clipping_planes_fragment>
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPow);
        gl_FragColor = vec4(uColor * (0.55 + 1.6 * f) * uGain, (uBase + uEdge * f) * uOpacity);
      }`,
  })
}

// Cutaway: a solid material clipped by a plane (keeps n·p + c ≥ 0). Pair it with stencilCaps() so the cut shows a
// solid, hatched section instead of a hollow shell.
export function cutawayMaterial(base, plane) {
  base.clippingPlanes = [plane]
  base.clipShadows = true
  base.side = THREE.FrontSide
  return base
}
// Stencil caps (three.js "clipping stencil" technique): every clipped closed mesh counts its back faces (+1) and front
// faces (−1) into the stencil buffer; a plane quad lying on the cut then draws only where the count ≠ 0, i.e. where
// the plane is inside metal — with the true depth of the plane, so parts in front of the cut still cover it.
// meshes: closed meshes using cutawayMaterial(…, plane). The returned cap is a child of `parent`, placed on the plane
// in parent space via place(point, normal). Needs the composer's stencil buffer (createRenderer sets it).
export function stencilCaps(meshes, plane, parent, { cap = 0xb9c3cf, hatch = 0x6f7c8c, spacing = 0.09, size = 14 } = {}) {
  const ops = op => ({ depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilFail: op, stencilZFail: op, stencilZPass: op, clippingPlanes: [plane] })
  const back = new THREE.MeshBasicMaterial({ side: THREE.BackSide, ...ops(THREE.IncrementWrapStencilOp) })
  const front = new THREE.MeshBasicMaterial({ side: THREE.FrontSide, ...ops(THREE.DecrementWrapStencilOp) })
  for (const m of meshes) for (const mat of [back, front]) { const s = new THREE.Mesh(m.geometry, mat); s.renderOrder = 20; s.raycast = () => {}; m.add(s) }
  const capMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
    uniforms: { uCap: { value: lin(cap) }, uHatch: { value: lin(hatch) }, uSpacing: { value: spacing } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uCap, uHatch; uniform float uSpacing; varying vec2 vP;
      void main(){ float s = (vP.x + vP.y) / uSpacing; float w = fwidth(s);
        float d = abs(fract(s) - 0.5) * 2.0; float line = smoothstep(0.86 - w, 0.86 + w, d);
        gl_FragColor = vec4(mix(uCap, uHatch, line * 0.9), 1.0); }`,
  })
  const capMesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), capMat)
  capMesh.renderOrder = 21
  capMesh.onAfterRender = r => r.clearStencil()
  parent.add(capMesh)
  const q = new THREE.Quaternion(), z = new THREE.Vector3(0, 0, 1)
  return {
    cap: capMesh, material: capMat,
    place(point, normal) { capMesh.position.copy(point); capMesh.quaternion.copy(q.setFromUnitVectors(z, normal)) },
    set visible(v) { capMesh.visible = v },
  }
}

// ───────────────────────────── particles (flows) ─────────────────────────────
// n soft round points; set(i, x, y, z, THREE.Color, alpha, size) then commit(camera). Additive, HDR-boosted so
// they bloom a little. Positions are in the parent's local space (add points to the engine/car group).
export function makeParticles(n, { size = 0.08, boost = 2.2 } = {}) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), alpha = new Float32Array(n), sz = new Float32Array(n).fill(1)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1))
  geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1))
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    uniforms: { uSize: { value: size }, uScale: { value: 1 }, uBoost: { value: boost } },
    vertexShader: `attribute float aAlpha; attribute float aSize; varying vec3 vC; varying float vA; uniform float uSize, uScale;
      void main(){ vC = color; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = max(1.0, uSize * aSize * uScale / -mv.z); }`,
    fragmentShader: `varying vec3 vC; varying float vA; uniform float uBoost;
      void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float d = dot(q, q); if (d > 1.0) discard;
        float a = vA * (1.0 - smoothstep(0.15, 1.0, d)); gl_FragColor = vec4(vC * uBoost * a, a); }`,
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false; points.renderOrder = 5
  const _s = new THREE.Vector3()
  return {
    points, n,
    set(i, x, y, z, c, a, s = 1) { pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; alpha[i] = a; sz[i] = s },
    hide(i) { alpha[i] = 0 },
    commit(camera, viewH = H) {   // viewH: drawing-buffer height in px (website: canvas height × pixel ratio)
      points.getWorldScale(_s)
      mat.uniforms.uScale.value = _s.x * (viewH / 2) / Math.tan(camera.fov * DEG / 2)
      for (const k of ['position', 'color', 'aAlpha', 'aSize']) geo.attributes[k].needsUpdate = true
    },
  }
}

// ───────────────────────────── geometry helpers ─────────────────────────────
// Loft a half-section along x and mirror it to −z. ringFn(x) → [[z, y], …] (same count every station, z ≥ 0,
// ordered so the surface faces outward: bottom centre → side → top centre). zoneFn(xMid, jMid) → material index
// (or −1 = no face). Normals are smooth inside one loft; separate lofts sharing an edge give a crisp crease.
function loft(xs, ringFn, { zoneFn = () => 0, zones = 1 } = {}) {
  const rings = xs.map(ringFn), M = rings[0].length, N = xs.length
  const pos = [], idxByZone = Array.from({ length: zones }, () => [])
  for (const side of [1, -1]) {
    const base = pos.length / 3
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { const [z, y] = rings[i][j]; pos.push(xs[i], y, side * z) }
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < M - 1; j++) {
      const zone = zoneFn((xs[i] + xs[i + 1]) / 2, j + 0.5, (rings[i][j][0] + rings[i][j + 1][0]) / 2)
      if (zone < 0) continue
      const a = base + i * M + j, b = base + (i + 1) * M + j, c = a + 1, d = b + 1
      if (side > 0) idxByZone[zone].push(a, b, d, a, d, c); else idxByZone[zone].push(a, d, b, a, c, d)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  const all = []; let start = 0
  for (let z = 0; z < zones; z++) { for (const v of idxByZone[z]) all.push(v); g.addGroup(start, idxByZone[z].length, z); start += idxByZone[z].length }
  g.setIndex(all)
  g.computeVertexNormals()
  // centre seam: both halves get the same normal (no z component) → no visible line down the middle
  const p = g.attributes.position, n = g.attributes.normal
  for (let i = 0; i < p.count; i++) if (Math.abs(p.getZ(i)) < 1e-6) { const x = n.getX(i), y = n.getY(i), l = Math.hypot(x, y) || 1; n.setXYZ(i, x / l, y / l, 0) }
  // zero-length normals from degenerate rings (nose tip): point them forward/back
  for (let i = 0; i < n.count; i++) { const l = Math.hypot(n.getX(i), n.getY(i), n.getZ(i)); if (!(l > 1e-6)) n.setXYZ(i, Math.sign(p.getX(i)) || 1, 0, 0) }
  return g
}
const bez = (p0, p1, p2, p3, t) => { const u = 1 - t; return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]] }
const sup = (u, p) => Math.pow(Math.max(0, 1 - Math.pow(clamp(u), p)), 1 / p) // superellipse quadrant 1 → 0
function stations(a, b, base, extra = []) {
  const s = new Set()
  for (let x = a; x <= b + 1e-9; x += base) s.add(+x.toFixed(5))
  s.add(+a.toFixed(5)); s.add(+b.toFixed(5))
  for (const [x0, x1, step] of extra) for (let x = x0; x <= x1 + 1e-9; x += step) if (x >= a && x <= b) s.add(+x.toFixed(5))
  return [...s].sort((p, q) => p - q)
}
// Merge geometries that share attributes position/normal (and optionally uv): converts to non-indexed first.
function mergeGeoms(list) {
  const geos = list.map(g => (g.index ? g.toNonIndexed() : g))
  let n = 0; for (const g of geos) n += g.attributes.position.count
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0
  for (const g of geos) { if (!g.attributes.normal) g.computeVertexNormals(); pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  return out
}
// Rounded box (ExtrudeGeometry of a rounded rect + bevel), centred at the origin.
export function roundedBox(w, h, d, r = 0.05, seg = 4) {
  r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)
  const sw = w - 2 * r, sh = h - 2 * r, cr = Math.min(sw, sh) * 0.04
  const s = new THREE.Shape()
  s.moveTo(-sw / 2 + cr, -sh / 2); s.lineTo(sw / 2 - cr, -sh / 2); s.quadraticCurveTo(sw / 2, -sh / 2, sw / 2, -sh / 2 + cr)
  s.lineTo(sw / 2, sh / 2 - cr); s.quadraticCurveTo(sw / 2, sh / 2, sw / 2 - cr, sh / 2); s.lineTo(-sw / 2 + cr, sh / 2)
  s.quadraticCurveTo(-sw / 2, sh / 2, -sw / 2, sh / 2 - cr); s.lineTo(-sw / 2, -sh / 2 + cr); s.quadraticCurveTo(-sw / 2, -sh / 2, -sw / 2 + cr, -sh / 2)
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: seg, curveSegments: 6 })
  g.translate(0, 0, -(d - 2 * r) / 2)
  return g
}
// ExtrudeGeometry only re-winds holes when it has to reverse the outline, so a hole wound like its outline ends up
// with inward-facing walls (invisible bores, broken stencil caps). Always give holes the opposite winding.
function shapeWithHoles(outline, holes) {
  const cw = THREE.ShapeUtils.isClockWise(outline), s = new THREE.Shape(outline)
  for (const h of holes) s.holes.push(new THREE.Path(THREE.ShapeUtils.isClockWise(h) === cw ? [...h].reverse() : h))
  return s
}
// Shape drawn in the (y, z) plane, extruded along x by `depth` (centred). pts = [[y, z], …].
function extrudeYZ(outline, holes, depth, bevel = 0.02) {
  const toV = ([y, z]) => new THREE.Vector2(-z, y)
  const s = shapeWithHoles(outline.map(toV), holes.map(h => h.map(toV)))
  const g = new THREE.ExtrudeGeometry(s, { depth: depth - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 24 })
  g.rotateY(Math.PI / 2) // shape (u,v,w) → world (w, v, −u): u = −z, v = y, extrusion → +x
  g.translate(-(depth - 2 * bevel) / 2, 0, 0)
  return g
}
// Shape drawn in the (x, z) plane (plan view), extruded up along y from y0 to y1.
function extrudeXZ(outline, holes, y0, y1, bevel = 0.02) {
  const toV = ([x, z]) => new THREE.Vector2(x, -z)
  const s = shapeWithHoles(outline.map(toV), holes.map(h => h.map(toV)))
  const g = new THREE.ExtrudeGeometry(s, { depth: y1 - y0 - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 48 })
  g.rotateX(-Math.PI / 2) // (u, v, w) → (u, w, −v): x = u, y = w, z = −v
  g.translate(0, y0 + bevel, 0)
  return g
}
const circle = (cy, cz, r, n = 48, a0 = 0, a1 = Math.PI * 2) => Array.from({ length: n }, (_, i) => { const a = a0 + (a1 - a0) * i / n; return [cy + r * Math.cos(a), cz + r * Math.sin(a)] })
const rrect = (x0, x1, z0, z1, r, n = 6) => {
  const p = [], arc = (cx, cz, a0) => { for (let i = 0; i <= n; i++) { const a = a0 + (Math.PI / 2) * i / n; p.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]) } }
  arc(x1 - r, z0 + r, -Math.PI / 2); arc(x1 - r, z1 - r, 0); arc(x0 + r, z1 - r, Math.PI / 2); arc(x0 + r, z0 + r, Math.PI)
  return p
}
const chaikin = (pts, it = 2) => { let p = pts; for (let k = 0; k < it; k++) { const q = []; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]) } p = q } return p }
function tube(points, radius, mat, { segs = 64, radial = 12, closed = false } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => (p.isVector3 ? p : new THREE.Vector3(...p))), closed, 'centripetal')
  return new THREE.Mesh(new THREE.TubeGeometry(curve, segs, radius, radial, closed), mat)
}

// ───────────────────────────── the generic car ─────────────────────────────
// makeCar({ paint, roof }) → { group, parts, anchors, update({ dist, brake, drl, wipe, scanGlow }) }.
// Brand-neutral by construction (ADR 0003): no grille pattern, badge, emblem or plate text; slim generic lights.
// parts: body, glass, wheels[4] {group, spin, tyre, rim}, brakeLights, mirrors.L/R, interior, engine slot.
// update({ wipe }): car-local x of the x-ray scan line — parts at x < wipe stay solid, x > wipe show as x-ray
// (wipe = +10 → all solid, −10 → all x-ray). Sweep it from +2.6 to −2.7 over a few beats for the reveal.
export function makeCar({ paint = 0x1b2633, roof = 'paint' } = {}) {
  const car = new THREE.Group(); car.name = 'car'
  const solid = new THREE.Group(); solid.name = 'car-solid'; car.add(solid)
  const M = {
    paint: MAT.paint(paint), glass: MAT.glass(), black: MAT.blackGloss(), satin: MAT.satin(), chrome: MAT.chrome(),
    rubber: MAT.rubber(), alloy: MAT.alloy(), alloyDark: MAT.alloyDark(), interior: MAT.interior(),
    lens: new THREE.MeshPhysicalMaterial({ color: lin(0x050608), metalness: 0.2, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.02 }),
    tailLens: new THREE.MeshPhysicalMaterial({ color: lin(0x2a0306), metalness: 0.1, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02, emissive: lin(0xff1a1a), emissiveIntensity: 0.25 }),
    drl: MAT.emissive(0xeef6ff, 12), tail: MAT.emissive(0xff2a1f, 2.2),
    disc: new THREE.MeshStandardMaterial({ color: lin(0x8d939b), metalness: 1, roughness: 0.42 }),
    caliper: new THREE.MeshStandardMaterial({ color: lin(0x3a4048), metalness: 0.5, roughness: 0.4 }),
    liner: new THREE.MeshStandardMaterial({ color: lin(0x050607), roughness: 1, side: THREE.DoubleSide }),
    gap: new THREE.MeshBasicMaterial({ color: lin(0x020304) }),
  }
  M.roof = roof === 'glass' ? M.glass : roof === 'black' ? M.black : M.paint
  const D = { xF: 2.34, xR: -2.38, axF: 1.40, axR: -1.44, track: 0.80, Rw: 0.352, Ra: 0.392, hw: 0.925 }

  // ---- side profile (metres) ----
  const NOSE = { y: 0.50, top0: 2.00, bot0: 2.20, pTop: 2.2, pBot: 3.6 }
  const TAIL = { y: 0.64, top0: -2.10, bot0: -2.04, pTop: 3.4, pBot: 2.4 }
  const topRaw = x => {
    if (x >= 0.95) { const s = (x - 0.95) / (D.xF - 0.95); return 0.99 - 0.215 * Math.pow(s, 1.6) }
    if (x >= -1.62) return 0.99 + 0.035 * (0.95 - x) / 2.57
    const s = (-1.62 - x) / (-1.62 - D.xR); return 1.025 + 0.018 * Math.sin(Math.PI * Math.min(s, 0.8) / 1.6)
  }
  const sillRaw = x => 0.19 + 0.06 * smooth(1.86, D.xF, x) + 0.11 * smooth(-1.92, D.xR, x)
  const endT = (x, raw, E, top) => {
    const x0 = top ? E.top0 : E.bot0, p = top ? E.pTop : E.pBot
    if (E === NOSE && x > x0) return E.y + (raw - E.y) * sup((x - x0) / (D.xF - x0), p)
    if (E === TAIL && x < x0) return E.y + (raw - E.y) * sup((x0 - x) / (x0 - D.xR), p)
    return raw
  }
  const yTop = x => endT(x, endT(x, topRaw(x), NOSE, true), TAIL, true)
  const ySill = x => endT(x, endT(x, sillRaw(x), NOSE, false), TAIL, false)
  const archY = x => { let y = -1; for (const ax of [D.axF, D.axR]) { const dx = x - ax; if (Math.abs(dx) < D.Ra) y = Math.max(y, D.Rw + Math.sqrt(D.Ra * D.Ra - dx * dx)) } return y }
  const yBot = x => Math.max(ySill(x), archY(x))
  const ysRaw = x => 0.815 - 0.03 * x / 2.34
  const yShoulder = x => {
    const yt = yTop(x), yb = ySill(x), fr = clamp((ysRaw(x) - sillRaw(x)) / (topRaw(x) - sillRaw(x)), 0.15, 0.9)
    return Math.min(yt - 0.004, Math.max(yb + (yt - yb) * fr, yBot(x) + 0.035))
  }
  const hwAt = x => {
    let w = D.hw
    for (const ax of [D.axF, D.axR]) w += 0.016 * Math.exp(-Math.pow((x - ax) / 0.5, 2))
    w -= 0.01 * Math.exp(-Math.pow((x + 0.15) / 0.8, 2))
    const rcF = 0.36, rcR = 0.32
    if (x > D.xF - rcF) w = (w - rcF * 0.86) + rcF * 0.86 * sup((x - (D.xF - rcF)) / rcF, 2.4)
    if (x < D.xR + rcR) w = (w - rcR * 0.86) + rcR * 0.86 * sup(((D.xR + rcR) - x) / rcR, 2.6)
    return w
  }
  const TUMBLE = 0.07
  const NU = 30
  // three lofts with crisp creases between them: sill (underbody + rocker), door face, upper body + deck
  const SILL_IN = 0.032
  const yLine = x => { const yb = ySill(x), ys = yShoulder(x); return Math.max(yb + 0.27 * (ys - yb), yBot(x) + 1e-4) }
  const sillRing = x => {
    const yb = yBot(x), yl = Math.min(yLine(x), yShoulder(x) - 1e-4), hw = hwAt(x), h = Math.max(yl - yb, 1e-5)
    const rr = Math.min(0.05, h * 0.5, hw * 0.25), zc = hw - SILL_IN - rr, pts = []
    for (let i = 0; i < 5; i++) pts.push([zc * i / 5, yb])
    for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (Math.PI / 2) * (i / 6); pts.push([zc + rr * Math.cos(a), yb + rr + rr * Math.sin(a)]) }
    for (let i = 1; i <= 3; i++) pts.push([hw - SILL_IN, lerp(yb + rr, yl, i / 3)])
    return pts
  }
  const doorRing = x => {
    const yl = Math.min(yLine(x), yShoulder(x) - 1e-4), ys = yShoulder(x), hw = hwAt(x), h = ys - yl
    const p0 = [hw - SILL_IN, yl], p3 = [hw - 0.004, ys]
    const p1 = [hw - 0.002, yl + h * 0.12], p2 = [hw + 0.009, ys - h * 0.35]
    return Array.from({ length: 16 }, (_, i) => bez(p0, p1, p2, p3, i / 15))
  }
  const upperRing = x => {
    const ys = yShoulder(x), yt = yTop(x), hw = hwAt(x), h = Math.max(yt - ys, 1e-4)
    const tumble = Math.min(TUMBLE, hw * 0.1), zt = hw - 0.004 - tumble
    const rt = Math.min(0.065, h * 0.45, zt * 0.25), crown = 0.028 * clamp(hw / D.hw)
    const pts = []
    const p0 = [hw - 0.004, ys], p3 = [zt, yt - rt]
    const p1 = [p0[0] - tumble * 0.25, p0[1] + (p3[1] - p0[1]) * 0.4], p2 = [p3[0] + 0.006, p3[1] - (p3[1] - p0[1]) * 0.3]
    const nS = 10, nC = 7, nD = NU - nS - nC
    for (let i = 0; i < nS; i++) pts.push(bez(p0, p1, p2, p3, i / nS))
    for (let i = 0; i < nC; i++) { const a = (Math.PI / 2) * (i / nC); pts.push([zt - rt + rt * Math.cos(a), yt - rt + rt * Math.sin(a)]) }
    const Z = Math.max(zt - rt, 1e-4)
    for (let i = 0; i < nD; i++) { const z = Z * (1 - i / (nD - 1)); pts.push([z, yt + crown * (1 - Math.pow(z / Z, 2))]) }
    return pts
  }
  const XS = stations(D.xR, D.xF, 0.018, [[D.xF - 0.40, D.xF, 0.006], [D.xR, D.xR + 0.36, 0.006],
    ...[D.axF, D.axR].flatMap(ax => [[ax - D.Ra - 0.03, ax - D.Ra + 0.03, 0.004], [ax + D.Ra - 0.03, ax + D.Ra + 0.03, 0.004], [ax - D.Ra, ax + D.Ra, 0.01]])])
  // cabin opening in the deck (so the interior shows through the glass)
  const CAB = { x0: -1.62, x1: 0.97 }
  const beltZ = x => hwAt(x) - 0.004 - TUMBLE - 0.035
  const bodySill = new THREE.Mesh(loft(XS, sillRing), M.paint)
  const bodyLower = new THREE.Mesh(loft(XS, doorRing), M.paint)
  const bodyUpper = new THREE.Mesh(loft(XS, upperRing, {
    zones: 1, zoneFn: (x, j, z) => (x > CAB.x0 + 0.03 && x < CAB.x1 - 0.03 && j > 12 && z < beltZ(x) - 0.004 ? -1 : 0),
  }), M.paint)
  bodySill.name = 'body-sill'; bodyLower.name = 'body-lower'; bodyUpper.name = 'body-upper'
  solid.add(bodySill, bodyLower, bodyUpper)

  // ---- greenhouse ----
  const roofCurve = new THREE.CatmullRomCurve3([[CAB.x1, yTop(CAB.x1)], [0.66, 1.15], [0.18, 1.36], [-0.25, 1.405], [-0.78, 1.385], [-1.2, 1.25], [CAB.x0, yTop(CAB.x0)]]
    .map(([x, y]) => new THREE.Vector3(x, y, 0)), false, 'centripetal')
  const roofPts = roofCurve.getSpacedPoints(600)
  const roofY = x => { for (let i = 0; i < roofPts.length - 1; i++) { const a = roofPts[i], b = roofPts[i + 1]; if ((x <= a.x && x >= b.x)) return lerp(a.y, b.y, (a.x - x) / ((a.x - b.x) || 1)) } return yTop(x) }
  const MS = 15, MC = 6, MR = 13
  const cabinRing = x => {
    const yb = yTop(x) - 0.014, yr = Math.max(roofY(x), yb), h = yr - yb
    const zb = beltZ(x), hk = smooth(0.0, 0.2, h)
    const ze = lerp(zb, 0.63 - 0.05 * Math.pow((x + 0.3) / 1.3, 2), hk)
    const rc = Math.min(0.07, h * 0.35), ye = yr - rc * 0.85
    const pts = []
    const p0 = [zb, yb], p3 = [ze, ye - rc * 0.2], p1 = [zb - (zb - ze) * 0.12, yb + (ye - yb) * 0.4], p2 = [ze + (zb - ze) * 0.12, ye - (ye - yb) * 0.25]
    for (let i = 0; i < MS; i++) pts.push(bez(p0, p1, p2, p3, i / MS))
    for (let i = 0; i < MC; i++) { const k = i / MC; pts.push(bez(p3, [ze, ye + rc * 0.3], [ze - rc * 0.4, yr], [ze - rc, yr - 0.002], k)) }
    const Z = Math.max(ze - rc, 1e-4)
    for (let i = 0; i < MR; i++) { const z = Z * (1 - i / (MR - 1)); pts.push([z, yr - 0.002 + 0.012 * hk * (1 - Math.pow(z / Z, 2))]) }
    return pts
  }
  const CXS = stations(CAB.x0, CAB.x1, 0.012, [[CAB.x1 - 0.12, CAB.x1, 0.004], [CAB.x0, CAB.x0 + 0.12, 0.004]])
  // zones: 0 glass, 1 frame (black gloss), 2 paint (C-pillar), 3 roof
  const cabZone = (x, j) => {
    const side = j < MS, edgeBand = (j >= MS - 2 && j < MS + MC + 2)
    if (x > 0.90) return 1                                   // cowl strip under the windscreen
    if (edgeBand) return 1                                   // A-pillars, roof rails, C-pillar edges (DLO frame)
    if (side) {
      if (x < -1.06) return 2                                // painted C-pillar
      if (x > -0.42 && x < -0.34) return 1                   // B-pillar
      return 0
    }
    if (x > 0.12) return 0                                   // windscreen
    if (x < -0.95) return 0                                  // rear glass
    return 3                                                 // roof panel
  }
  const cabin = new THREE.Mesh(loft(CXS, cabinRing, { zones: 4, zoneFn: cabZone }), [M.glass, M.black, M.paint, M.roof])
  cabin.name = 'cabin'; solid.add(cabin)
  // chrome DLO line along the belt
  for (const sg of [1, -1]) {
    const pts = []; for (let x = -1.05; x <= 0.9; x += 0.05) pts.push([x, yTop(x) - 0.006, sg * (beltZ(x) + 0.006)])
    solid.add(tube(pts, 0.006, M.chrome, { segs: 80, radial: 8 }))
  }

  // ---- interior (visible through the glass, faint) ----
  const interior = new THREE.Group(); interior.name = 'interior'; solid.add(interior)
  const tub = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.75, 1.62), new THREE.MeshStandardMaterial({ color: lin(0x0d1014), roughness: 0.9, side: THREE.BackSide }))
  tub.position.set(-0.3, 0.62, 0); interior.add(tub)
  const seatGeo = roundedBox(0.52, 0.12, 0.5, 0.05), backGeo = roundedBox(0.12, 0.66, 0.48, 0.05)
  for (const [sx, sz] of [[-0.25, 0.38], [-0.25, -0.38], [-1.1, 0.38], [-1.1, -0.38]]) {
    const sb = new THREE.Mesh(seatGeo, M.interior); sb.position.set(sx, 0.55, sz); interior.add(sb)
    const bk = new THREE.Mesh(backGeo, M.interior); bk.position.set(sx - 0.3, 0.9, sz); bk.rotation.z = 0.2; interior.add(bk)
  }
  const dash = new THREE.Mesh(roundedBox(0.5, 0.2, 1.55, 0.07), M.interior); dash.position.set(0.62, 0.92, 0); interior.add(dash)
  const wheelSt = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.022, 12, 40), M.satin); wheelSt.position.set(0.32, 0.98, 0.38); wheelSt.rotation.y = Math.PI / 2; wheelSt.rotation.x = 0.0; wheelSt.rotateX(0.38); interior.add(wheelSt)

  // ---- surface helpers (raycast details onto the body) ----
  const bodyMeshes = [bodySill, bodyLower, bodyUpper]
  car.updateMatrixWorld(true)
  const rc = new THREE.Raycaster()
  // website: the same raycasts against the same triangles, bucketed into x-slabs with bounding spheres and visited near to
  // far with an exact early exit (no slab can be closer than its sphere), so the car builds ~10× faster with identical hits
  const slabs = (() => {
    const N = 48, out = [], x0 = D.xR - 0.05, x1 = D.xF + 0.05, mat = new THREE.MeshBasicMaterial()
    for (const m of bodyMeshes) {
      const pos = m.geometry.attributes.position.array, idx = m.geometry.index.array, buckets = Array.from({ length: N }, () => [])
      for (let t = 0; t < idx.length; t += 3) {
        const cx = (pos[idx[t] * 3] + pos[idx[t + 1] * 3] + pos[idx[t + 2] * 3]) / 3
        buckets[Math.min(N - 1, Math.max(0, Math.floor((cx - x0) / (x1 - x0) * N)))].push(idx[t], idx[t + 1], idx[t + 2])
      }
      for (const b of buckets) {
        if (!b.length) continue
        const arr = new Float32Array(b.length * 3)
        for (let i = 0; i < b.length; i++) { arr[i * 3] = pos[b[i] * 3]; arr[i * 3 + 1] = pos[b[i] * 3 + 1]; arr[i * 3 + 2] = pos[b[i] * 3 + 2] }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3)); g.computeBoundingSphere()
        const mesh = new THREE.Mesh(g, mat); mesh.updateMatrixWorld(true); out.push({ mesh, sphere: g.boundingSphere })
      }
    }
    return out
  })()
  const _enter = new THREE.Vector3()
  const hit = (o, d) => {
    rc.set(o, d.clone().normalize())
    const ray = rc.ray, cand = []
    for (const sl of slabs) {
      if (sl.sphere.containsPoint(ray.origin)) cand.push([0, sl])
      else if (ray.intersectSphere(sl.sphere, _enter)) cand.push([ray.origin.distanceTo(_enter), sl])
    }
    cand.sort((a, b) => a[0] - b[0])
    let best = null
    for (const [enter, sl] of cand) { if (best && enter > best.distance) break; const h = rc.intersectObject(sl.mesh, false)[0]; if (h && (!best || h.distance < best.distance)) best = h }
    return best ? { p: best.point.clone(), n: best.face.normal.clone() } : null
  }
  const conform = (samples, radius, offset, mat, segs = 64) => {
    const pts = []; for (const [o, d] of samples) { const h = hit(o, d); if (h) pts.push(h.p.add(h.n.multiplyScalar(offset))) }
    if (pts.length < 2) return null
    const m = tube(pts, radius, mat, { segs, radial: 10 }); solid.add(m)
    for (const p of [pts[0], pts[pts.length - 1]]) { const cap = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 8), mat); cap.position.copy(p); solid.add(cap) }
    return m
  }
  // flush ribbon on the body: a strip of given width lying in the surface (lights, lenses, intakes)
  const ribbon = (samples, width, offset, mat, { taper = 0 } = {}) => {
    const P = [], N = []
    for (const [o, d] of samples) { const h = hit(o, d); if (h) { P.push(h.p); N.push(h.n) } }
    if (P.length < 3) return null
    const curve = new THREE.CatmullRomCurve3(P, false, 'centripetal'), n = 60, pos = [], idx = []
    for (let i = 0; i <= n; i++) {
      const u = i / n, p = curve.getPointAt(u), tg = curve.getTangentAt(u)
      const k = Math.min(Math.round(u * (P.length - 1)), P.length - 1), nr = N[k].clone().lerp(N[Math.min(k + 1, N.length - 1)], 0).normalize()
      const b = new THREE.Vector3().crossVectors(nr, tg).normalize()
      const w = width * (1 - taper * Math.pow(Math.abs(2 * u - 1), 3)) / 2
      const c = p.clone().addScaledVector(nr, offset)
      pos.push(...c.clone().addScaledVector(b, w).toArray(), ...c.clone().addScaledVector(b, -w).toArray())
      if (i < n) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals()
    const m = new THREE.Mesh(g, mat); m.material.side = THREE.DoubleSide; solid.add(m); return m
  }
  const V = (x, y, z) => new THREE.Vector3(x, y, z)
  // rays around a vertical pivot so strips wrap the corners (front: pivot x = 1.7; rear: −1.7)
  const wrap = (px, y0, y1, a0, a1, n, sg, front) => Array.from({ length: n }, (_, i) => {
    const k = i / (n - 1), a = lerp(a0, a1, k) * DEG, y = lerp(y0, y1, k), dirx = front ? Math.cos(a) : -Math.cos(a)
    return [V(px + dirx * 6, y, sg * Math.sin(a) * 6), V(-dirx, 0, -sg * Math.sin(a))]
  })
  const lights = { drl: [], tail: [] }
  for (const sg of [1, -1]) {
    ribbon(wrap(1.7, 0.668, 0.69, 12, 64, 18, sg, true), 0.07, 0.002, M.lens, { taper: 0.5 })                 // headlight lens, flush
    lights.drl.push(ribbon(wrap(1.7, 0.684, 0.706, 14, 61, 18, sg, true), 0.011, 0.004, M.drl, { taper: 0.3 })) // LED line
    ribbon(wrap(1.7, 0.42, 0.52, 58, 66, 6, sg, true), 0.03, 0.002, M.black)                                     // corner air curtain
    ribbon(wrap(-1.7, 0.85, 0.855, 2, 60, 18, sg, false), 0.055, 0.002, M.tailLens, { taper: 0.4 })
    lights.tail.push(ribbon(wrap(-1.7, 0.857, 0.861, 3, 58, 18, sg, false), 0.012, 0.004, M.tail, { taper: 0.2 }))
  }
  // lower front intake and rear diffuser: plain black bands, no grille pattern
  ribbon(Array.from({ length: 13 }, (_, i) => [V(6, 0.335, lerp(-0.58, 0.58, i / 12)), V(-1, 0, 0)]), 0.075, 0.002, M.black, { taper: 0.3 })
  ribbon(Array.from({ length: 13 }, (_, i) => [V(-6, 0.30, lerp(-0.64, 0.64, i / 12)), V(1, 0, 0)]), 0.09, 0.002, M.satin, { taper: 0.2 })
  // panel gaps (doors, hood, boot) and flush handles
  for (const sg of [1, -1]) {
    const S = (x, y) => [V(x, y, sg * 4), V(0, 0, -sg)]
    for (const [xb, xt] of [[0.97, 0.90], [-0.36, -0.40]]) conform(Array.from({ length: 9 }, (_, i) => S(lerp(xb, xt, i / 8), lerp(0.24, yTop(xt) - 0.03, i / 8))), 0.0026, 0.0, M.gap, 24)
    const rr = []; for (let i = 0; i <= 14; i++) { const a = lerp(180, 95, i / 14) * DEG; rr.push(S(D.axR + (D.Ra + 0.045) * Math.cos(a) + 0.02, D.Rw + (D.Ra + 0.045) * Math.sin(a))) }
    rr.push(S(-1.05, 0.92)); rr.push(S(-1.07, yTop(-1.07) - 0.03)); conform(rr, 0.0026, 0.0, M.gap, 40)
    conform(Array.from({ length: 10 }, (_, i) => S(lerp(0.92, -1.0, i / 9), 0.255)), 0.0026, 0.0, M.gap, 30) // sill line
    for (const hx of [0.36, -0.72]) {
      const h = hit(V(hx, 0.9, sg * 4), V(0, 0, -sg))
      if (h) { const m = new THREE.Mesh(roundedBox(0.16, 0.022, 0.012, 0.005), M.black); m.position.copy(h.p).add(h.n.clone().multiplyScalar(0.002)); m.lookAt(h.p.clone().add(h.n)); m.rotateY(Math.PI / 2 * 0); solid.add(m) }
    }
    const T = (x, z) => [V(x, 4, z), V(0, -1, 0)]
    conform(Array.from({ length: 12 }, (_, i) => T(lerp(2.06, 0.97, i / 11), sg * lerp(0.60, 0.66, i / 11))), 0.0026, 0.0, M.gap, 30)
    conform(Array.from({ length: 10 }, (_, i) => T(lerp(-1.66, -2.16, i / 9), sg * lerp(0.70, 0.62, i / 9))), 0.0026, 0.0, M.gap, 30)
  }
  conform(Array.from({ length: 11 }, (_, i) => [V(2.07, 4, lerp(-0.6, 0.6, i / 10)), V(0, -1, 0)]), 0.0026, 0.0, M.gap, 30)
  conform(Array.from({ length: 11 }, (_, i) => [V(-1.66, 4, lerp(-0.7, 0.7, i / 10)), V(0, -1, 0)]), 0.0026, 0.0, M.gap, 30)

  // ---- mirrors ----
  const mirrors = {}
  for (const [name, sg] of [['R', 1], ['L', -1]]) {
    const g = new THREE.Group(); g.name = 'mirror' + name
    const s = new THREE.Shape(); s.moveTo(-0.11, -0.045); s.quadraticCurveTo(0.02, -0.07, 0.11, -0.03); s.quadraticCurveTo(0.13, 0.03, 0.09, 0.06); s.quadraticCurveTo(-0.02, 0.075, -0.1, 0.045); s.quadraticCurveTo(-0.125, 0.0, -0.11, -0.045)
    const capG = new THREE.ExtrudeGeometry(s, { depth: 0.13, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 4, curveSegments: 16 })
    capG.translate(0, 0, -0.065)
    const cap = new THREE.Mesh(capG, M.paint); g.add(cap)
    const arm = new THREE.Mesh(roundedBox(0.09, 0.03, 0.22, 0.012), M.black); arm.position.set(0.0, -0.04, -sg * 0.15); g.add(arm)
    g.position.set(0.80, 1.035, sg * 1.0); g.rotation.y = sg * 0.06
    solid.add(g); mirrors[name] = g
  }

  // ---- wheels ----
  const tyreProfile = (() => {
    const R = D.Rw, Wd = 0.122, p = []
    const add = (r, y) => p.push(new THREE.Vector2(r, y))
    add(0.236, -0.104); add(0.25, -0.112); add(0.262, -0.118); add(0.268, -0.116); add(0.276, -0.121); add(0.30, -0.124); add(0.322, -0.121); add(0.338, -0.112); add(0.347, -0.098); add(R, -0.084)
    for (const y0 of [-0.06, -0.02, 0.02, 0.06]) { add(R, y0 - 0.008); add(R - 0.009, y0 - 0.005); add(R - 0.009, y0 + 0.005); add(R, y0 + 0.008) }
    add(R, 0.084); add(0.347, 0.098); add(0.338, 0.112); add(0.322, 0.121); add(0.30, 0.124); add(0.276, 0.121); add(0.268, 0.116); add(0.262, 0.118); add(0.25, 0.112); add(0.236, 0.104)
    void Wd; return p
  })()
  const tyreGeo = new THREE.LatheGeometry(tyreProfile, 120); tyreGeo.rotateX(Math.PI / 2)
  const rimFace = (() => {
    // twin five-spoke: each spoke is its own bevelled extrusion, tilted so the hub sits deeper (concave face)
    const parts = [], r0 = 0.062, r1 = 0.226, tilt = 0.24
    const spoke = new THREE.Shape()
    spoke.moveTo(r0, -0.026); spoke.lineTo(r1, -0.017); spoke.quadraticCurveTo(r1 + 0.008, 0, r1, 0.017); spoke.lineTo(r0, 0.026); spoke.closePath()
    const sg = new THREE.ExtrudeGeometry(spoke, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.004, bevelSegments: 3, curveSegments: 8 })
    sg.rotateY(-tilt); sg.translate(0, 0, -r1 * Math.sin(tilt) + 0.004)
    for (let k = 0; k < 5; k++) for (const d of [-9.5, 9.5]) { const g = sg.clone(); g.rotateZ((k * 72 + d) * DEG); parts.push(g) }
    const hubG = new THREE.CylinderGeometry(0.075, 0.08, 0.03, 40); hubG.rotateX(Math.PI / 2); hubG.translate(0, 0, -r1 * Math.sin(tilt) + 0.012); parts.push(hubG)
    const merged = mergeGeoms(parts)
    return merged
  })()
  const lipGeo = new THREE.LatheGeometry([[0.222, -0.11], [0.226, 0.07], [0.234, 0.084], [0.243, 0.09], [0.247, 0.082], [0.240, -0.11]].map(([r, y]) => new THREE.Vector2(r, y)), 120); lipGeo.rotateX(Math.PI / 2)
  const barrelGeo = new THREE.CylinderGeometry(0.222, 0.222, 0.2, 64, 1, true); barrelGeo.rotateX(Math.PI / 2)
  const hubGeo = new THREE.CylinderGeometry(0.052, 0.056, 0.03, 40); hubGeo.rotateX(Math.PI / 2)
  const lugGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.02, 12); lugGeo.rotateX(Math.PI / 2)
  const discGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.026, 64); discGeo.rotateX(Math.PI / 2)
  const wheels = []
  for (const [ax, front] of [[D.axF, true], [D.axR, false]]) for (const sg of [1, -1]) {
    const w = new THREE.Group(), spin = new THREE.Group(); w.add(spin)
    const tyre = new THREE.Mesh(tyreGeo, M.rubber); spin.add(tyre)
    const rim = new THREE.Mesh(rimFace, M.alloy); rim.position.z = 0.082; spin.add(rim)
    const lip = new THREE.Mesh(lipGeo, M.alloy); lip.position.z = 0.0; spin.add(lip)
    const barrel = new THREE.Mesh(barrelGeo, M.alloyDark); barrel.material = M.alloyDark; barrel.position.z = -0.02; spin.add(barrel)
    const hub = new THREE.Mesh(hubGeo, M.alloyDark); hub.position.z = 0.03; spin.add(hub)
    for (let k = 0; k < 5; k++) { const a = k * Math.PI * 2 / 5, l = new THREE.Mesh(lugGeo, M.chrome); l.position.set(0.072 * Math.cos(a), 0.072 * Math.sin(a), 0.03); spin.add(l) }
    const disc = new THREE.Mesh(discGeo, M.disc); disc.position.z = -0.03; w.add(disc)
    const cal = new THREE.Mesh(roundedBox(0.16, 0.07, 0.07, 0.02), M.caliper); const ca = front ? 2.3 : 0.85
    cal.position.set(Math.cos(ca) * 0.15, Math.sin(ca) * 0.15, -0.02); cal.rotation.z = ca - Math.PI / 2; w.add(cal)
    const back = new THREE.Mesh(new THREE.CircleGeometry(0.222, 48), M.liner); back.position.z = -0.1; spin.add(back)
    w.position.set(ax, D.Rw, sg * D.track); if (sg < 0) w.rotation.y = Math.PI
    solid.add(w); wheels.push({ group: w, spin, tyre, rim, disc, caliper: cal, x: ax, sg, front })
  }
  // arch liners
  for (const ax of [D.axF, D.axR]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(D.Ra - 0.004, D.Ra - 0.004, 1.74, 48, 1, true, Math.PI / 2, Math.PI), M.liner)
    l.geometry.rotateX(Math.PI / 2); l.position.set(ax, D.Rw, 0); l.userData.noXray = true; solid.add(l)
  }
  solid.traverse(o => { if (o.isMesh) { o.castShadow = o.material !== M.glass; o.receiveShadow = false } })

  // ---- x-ray twins (same geometry, fresnel shells), revealed by the wipe ----
  const planeSolid = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 10), planeXray = new THREE.Plane(new THREE.Vector3(1, 0, 0), -10)
  const localSolid = planeSolid.clone(), localXray = planeXray.clone()
  const XR = {
    shell: xrayMaterial({ color: 0x7fb4ff, base: 0.03, edge: 0.55, clippingPlanes: [planeXray] }),
    glass: xrayMaterial({ color: 0x7fb4ff, base: 0.012, edge: 0.3, clippingPlanes: [planeXray] }),
    tyre: xrayMaterial({ color: 0xaab6c4, base: 0.05, edge: 0.55, clippingPlanes: [planeXray] }),
    inner: xrayMaterial({ color: 0x9fb3c8, base: 0.02, edge: 0.28, clippingPlanes: [planeXray] }),
  }
  const xray = new THREE.Group(); xray.name = 'car-xray'; car.add(xray)
  const solidMats = new Set()
  solid.updateMatrixWorld(true)
  solid.traverse(o => {
    if (!o.isMesh) return
    for (const m of [].concat(o.material)) solidMats.add(m)
    if (o.userData.noXray || o === tub) return
    const mats = [].concat(o.material)
    let xm = XR.shell
    if (mats.every(m => m === M.glass)) xm = XR.glass
    else if (mats[0] === M.rubber) xm = XR.tyre
    else if (interior.getObjectById(o.id)) xm = XR.inner
    else if (mats[0] === M.drl || mats[0] === M.tail || mats[0] === M.gap) return
    const twin = new THREE.Mesh(o.geometry, xm)
    o.matrixWorld.decompose(twin.position, twin.quaternion, twin.scale) // car is at the origin while building
    twin.userData.source = o; twin.renderOrder = 2
    xray.add(twin)
  })
  // wheels' spin must reach the twins too: re-parent twin wheel parts under per-wheel groups
  const twinWheels = wheels.map(w => {
    const g = new THREE.Group(), spin = new THREE.Group(); g.add(spin)
    g.position.copy(w.group.position); g.rotation.copy(w.group.rotation); xray.add(g)
    for (const tw of [...xray.children]) {
      const src = tw.userData.source; if (!src) continue
      let p = src.parent; while (p && p !== w.group) p = p.parent
      if (p !== w.group) continue
      xray.remove(tw); const inSpin = w.spin.getObjectById(src.id)
      tw.position.copy(src.position); tw.quaternion.copy(src.quaternion); tw.scale.copy(src.scale);
      (inSpin ? spin : g).add(tw)
    }
    return { group: g, spin }
  })
  for (const m of solidMats) { m.clippingPlanes = [planeSolid]; m.clipShadows = true }
  // scan sheet: a thin glowing section plane at the wipe position
  const scan = new THREE.Group(); car.add(scan)
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: lin(FLOW.air).multiplyScalar(0.5), transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
  sheet.rotation.y = Math.PI / 2; sheet.scale.set(2.1, 1.5, 1); sheet.position.y = 0.75; scan.add(sheet)
  const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(2.1, 1.5)), new THREE.LineBasicMaterial({ color: lin(FLOW.air).multiplyScalar(4), transparent: true, opacity: 0.9 }))
  frame.rotation.y = Math.PI / 2; frame.position.y = 0.75; scan.add(frame)

  // ---- anchors for labels ----
  const anchor = (name, x, y, z) => { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); car.add(o); return o }
  const anchors = {
    engineBay: anchor('engineBay', 1.62, 0.78, 0), roof: anchor('roof', -0.3, 1.42, 0), frontWheel: anchor('frontWheel', D.axF, D.Rw, D.track + 0.12),
    rearWheel: anchor('rearWheel', D.axR, D.Rw, D.track + 0.12), tailLight: anchor('tailLight', D.xR + 0.05, 0.86, 0.6), headLight: anchor('headLight', D.xF - 0.12, 0.69, 0.6),
    mirrorR: anchor('mirrorR', 0.80, 1.05, 1.08), cabin: anchor('cabin', -0.3, 1.0, 0),
  }
  // engine slot: put an engine kit group here (scale 0.1, transverse) for x-ray scenes
  const engineSlot = new THREE.Group(); engineSlot.name = 'engineSlot'; engineSlot.position.set(1.66, 0.36, 0); engineSlot.rotation.y = Math.PI / 2; car.add(engineSlot)

  const api = {
    group: car, solid, xray, scan, interior, wheels, mirrors, anchors, engineSlot, materials: M, dims: D,
    parts: { body: [bodySill, bodyLower, bodyUpper], cabin, wheels, mirrors, interior, brakeLights: lights.tail, drl: lights.drl },
    // dist: metres travelled (wheels roll dist / R); brake 0…1; drl 0…1; wipe: x-ray scan position (car-local x)
    update({ dist = 0, brake = 0, drl = 1, wipe = 10, scanGlow = 1 } = {}) {
      for (const [i, w] of wheels.entries()) { const a = (w.sg > 0 ? -1 : 1) * dist / D.Rw; w.spin.rotation.z = a; twinWheels[i].spin.rotation.z = a }
      M.tail.emissiveIntensity = 2.5 + 12 * brake
      M.tailLens.emissiveIntensity = 0.25 + 1.2 * brake
      M.drl.emissiveIntensity = 12 * drl
      car.updateMatrixWorld(true)
      localSolid.constant = wipe; localXray.constant = -wipe
      planeSolid.copy(localSolid).applyMatrix4(car.matrixWorld)
      planeXray.copy(localXray).applyMatrix4(car.matrixWorld)
      solid.visible = wipe > D.xR - 0.05
      xray.visible = wipe < D.xF + 0.05
      scan.visible = scanGlow > 0.001 && wipe < D.xF + 0.3 && wipe > D.xR - 0.3
      scan.position.x = wipe
      frame.material.opacity = 0.9 * scanGlow; sheet.material.opacity = 0.12 * scanGlow
    },
  }
  api.update()
  return api
}

// ───────────────────────────── engine cutaway kit: inline-4, DOHC 16V ─────────────────────────────
// makeEngine({ look }) → { group, update(theta, opts), anchors, phase(i, theta), … }.  Units: decimetres.
// theta = crank angle in degrees (any real number; drive it from t, e.g. theta = 150 * (t − t0) for slow motion).
// Cycle angle of cylinder i: φ = (θ − OFF[i]) mod 720; φ 0–180 intake, 180–360 compression, 360–540 power,
// 540–720 exhaust (φ = 0 is TDC at the start of intake). Firing order 1-3-4-2 → OFF = [0, 540, 180, 360].
// Kinematics are exact slider-crank: pin (r cos α, r sin α), piston pin y = r cos α + √(l² − r² sin² α).
// Valves follow a smooth lift curve; the cam lobes are built from the same curve, so lobe and bucket always touch.
export const STROKES = ['intake', 'compression', 'power', 'exhaust']
export function makeEngine({ look = 'xray', cutX = null } = {}) {
  const E = { bore: 0.86, r: 0.43, l: 1.45, pitch: 0.98, compH: 0.30, deck: 2.20, roof: 2.33 }
  const XS = [1.5, 0.5, -0.5, -1.5].map(k => k * E.pitch)
  const OFF = [0, 540, 180, 360]
  const V = { inOpen: -14, inDur: 228, exOpen: 506, exDur: 228, lift: 0.14, tilt: 19 * DEG, zSeat: 0.21, ySeat: 2.33, len: 1.0, dx: 0.2, rb: 0.15, bucket: 0.12 }
  const SPARK = 350
  const group = new THREE.Group(); group.name = 'engine'
  const bump = (phi, open, dur) => { const u = mod(phi - open, 720) / dur; return u < 1 ? Math.pow(Math.sin(Math.PI * u), 2) : 0 }
  const liftIn = phi => V.lift * bump(phi, V.inOpen, V.inDur)
  const liftEx = phi => V.lift * bump(phi, V.exOpen, V.exDur)
  // cumulative flow tables (for particles that move only while a valve is open)
  const cum = f => { const T = new Float64Array(721); for (let k = 1; k <= 720; k++) T[k] = T[k - 1] + 0.5 * (f(k - 1) + f(k)) / V.lift; return T }
  const CIN = cum(liftIn), CEX = cum(liftEx)
  const cumAt = (T, theta, i) => { const a = theta - OFF[i], c = Math.floor(a / 720), phi = a - c * 720, k = Math.floor(phi), fr = phi - k; return c * T[720] + T[k] + (T[Math.min(k + 1, 720)] - T[k]) * fr }
  const phase = (i, theta) => mod(theta - OFF[i], 720)

  // ---- materials ----
  const steel = MAT.steel(), dark = MAT.alloyDark()
  const mats = {
    piston: XS.map(() => MAT.active(0xc9cfd6, { roughness: 0.28 })),
    rod: XS.map(() => MAT.active(0x8d96a0, { roughness: 0.34 })),
    valveIn: XS.map(() => MAT.active(0xb4bcc6, { roughness: 0.25 })),
    valveEx: XS.map(() => MAT.active(0xb4bcc6, { roughness: 0.25 })),
    lobeIn: XS.map(() => MAT.active(0x7c8590, { roughness: 0.22 })),
    lobeEx: XS.map(() => MAT.active(0x7c8590, { roughness: 0.22 })),
    crank: MAT.active(0x8f98a3, { roughness: 0.3 }),
    spring: new THREE.MeshStandardMaterial({ color: lin(0x5d8fd6), metalness: 0.6, roughness: 0.35 }),
    ceramic: new THREE.MeshStandardMaterial({ color: lin(0xeef1f4), metalness: 0, roughness: 0.35 }),
    coil: new THREE.MeshStandardMaterial({ color: lin(0x2a3038), metalness: 0.3, roughness: 0.55 }),
    fuelRail: new THREE.MeshStandardMaterial({ color: lin(0x6b4a2a), metalness: 0.7, roughness: 0.35, emissive: lin(FLOW.fuel), emissiveIntensity: 0.25 }),
    sparkTip: XS.map(() => MAT.emissive(0xbfe0ff, 0)),
  }
  const XRAY = {
    block: xrayMaterial({ color: 0x7fb4ff, base: 0.03, edge: 0.6 }),
    head: xrayMaterial({ color: 0x7fb4ff, base: 0.025, edge: 0.55 }),
    liner: xrayMaterial({ color: 0x9fc4ff, base: 0.02, edge: 0.45 }),
    intake: xrayMaterial({ color: FLOW.air, base: 0.03, edge: 0.55, gain: 0.8 }),
    exhaust: xrayMaterial({ color: 0xc7a08a, base: 0.03, edge: 0.55, gain: 0.8 }),
  }

  // ---- static housings ----
  const housing = new THREE.Group(); housing.name = 'housing'; group.add(housing)
  const blockX = new THREE.Mesh(roundedBox(4.26, 2.5, 1.66, 0.12), XRAY.block); blockX.position.set(0, 0.95, 0)
  const pan = new THREE.Mesh(roundedBox(3.9, 0.75, 1.5, 0.14), XRAY.block); pan.position.set(0, -0.62, 0)
  const headX = new THREE.Mesh(roundedBox(4.26, 1.66, 1.74, 0.1), XRAY.head); headX.position.set(0, 3.03, 0)
  const cover = new THREE.Mesh(roundedBox(4.1, 0.42, 1.6, 0.16), XRAY.head); cover.position.set(0, 4.02, 0)
  housing.add(blockX, pan, headX, cover)
  const liners = XS.map(x => { const m = new THREE.Mesh(new THREE.CylinderGeometry(E.bore / 2 + 0.005, E.bore / 2 + 0.005, E.deck - 0.9, 48, 1, true), XRAY.liner); m.position.set(x, (E.deck + 0.9) / 2, 0); housing.add(m); return m })
  // solid cutaway block: bores are real holes, the crankcase is open, clipped by a plane at cutX with hatched caps
  const cutPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0)
  const cutLocal = cutPlane.clone()
  const blockMat = cutawayMaterial(new THREE.MeshStandardMaterial({ color: lin(0x7c8a9c), metalness: 0.25, roughness: 0.55 }), cutPlane)
  const cutBlock = new THREE.Group(); cutBlock.name = 'cutBlock'; group.add(cutBlock)
  {
    const outer = rrect(-2.13, 2.13, -0.83, 0.83, 0.12)
    const bores = XS.map(x => circle(x, 0, E.bore / 2 + 0.005, 64))
    const upper = new THREE.Mesh(extrudeXZ(outer, bores, 0.9, E.deck, 0.03), blockMat)
    const crank = new THREE.Mesh(extrudeXZ(rrect(-2.13, 2.13, -0.92, 0.92, 0.16), [rrect(-1.98, 1.98, -0.74, 0.74, 0.1)], -0.3, 0.9, 0.03), blockMat)
    const panS = new THREE.Mesh(extrudeXZ(rrect(-1.95, 1.95, -0.75, 0.75, 0.14), [rrect(-1.85, 1.85, -0.65, 0.65, 0.1)], -1.0, -0.3, 0.03), blockMat)
    const panFloor = new THREE.Mesh(roundedBox(3.9, 0.08, 1.5, 0.03), blockMat); panFloor.position.set(0, -0.98, 0)
    cutBlock.add(upper, crank, panS, panFloor)
    // main bearing bulkheads between cylinders (give the crankcase section some structure)
    for (const x of [1.96, 0.98, 0, -0.98, -1.96]) {
      const bh = new THREE.Mesh(extrudeYZ(rrect(-0.3, 0.9, -0.72, 0.72, 0.08).map(([a, b]) => [a, b]), [circle(0, 0, 0.3, 40)], 0.14, 0.02), blockMat)
      bh.position.x = x; cutBlock.add(bh)
    }
  }

  // ---- crankshaft ----
  const crank = new THREE.Group(); crank.name = 'crankshaft'; group.add(crank)
  const cyl = (r, len, mat, n = 40) => { const g = new THREE.CylinderGeometry(r, r, len, n); g.rotateZ(Math.PI / 2); return new THREE.Mesh(g, mat) }
  const webShape = (() => {
    const pts = []
    for (let i = 0; i <= 20; i++) { const a = lerp(-90, 90, i / 20) * DEG; pts.push([E.r + 0.27 * Math.cos(a), 0.27 * Math.sin(a)]) }
    for (let i = 0; i <= 24; i++) { const a = lerp(128, 232, i / 24) * DEG; pts.push([0.66 * Math.cos(a), 0.66 * Math.sin(a)]) }
    return extrudeYZ(chaikin(pts.map(([y, z]) => [y, z]), 1), [], 0.13, 0.025)
  })()
  let frontWeb = null, frontMain = null
  for (let i = 0; i < 4; i++) {
    const throwG = new THREE.Group(); throwG.position.x = XS[i]; throwG.rotation.x = (i === 1 || i === 2) ? Math.PI : 0; crank.add(throwG)
    for (const s of [-1, 1]) { const w = new THREE.Mesh(webShape, mats.crank); w.position.x = s * 0.2; throwG.add(w); if (i === 0 && s > 0) frontWeb = w }
    const pin = cyl(0.19, 0.3, mats.crank); pin.position.y = E.r; throwG.add(pin)
  }
  for (const x of [1.96, 0.98, 0, -0.98, -1.96]) { const j = cyl(0.25, 0.42, mats.crank); j.position.x = x; crank.add(j); if (x > 1.9) frontMain = j }
  const snout = cyl(0.17, 0.5, mats.crank); snout.position.x = 2.35; crank.add(snout)
  const pulley = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 12, 48), dark); pulley.rotation.y = Math.PI / 2; pulley.position.x = 2.55; crank.add(pulley)
  const pulleyDisc = cyl(0.42, 0.06, dark, 48); pulleyDisc.position.x = 2.55; crank.add(pulleyDisc)
  const crankSprocket = cyl(0.3, 0.1, steel, 32); crankSprocket.position.x = 2.3; crank.add(crankSprocket)
  const fly = new THREE.Group(); fly.position.x = -2.38; crank.add(fly)
  { const fw = cyl(1.0, 0.12, dark, 96); fly.add(fw); const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.035, 8, 96), steel); ring.rotation.y = Math.PI / 2; fly.add(ring)
    for (let k = 0; k < 6; k++) { const h = cyl(0.12, 0.13, steel, 20); const a = k * Math.PI / 3; h.position.set(0, 0.6 * Math.cos(a), 0.6 * Math.sin(a)); fly.add(h) } }
  crank.traverse(o => { if (o.isMesh) o.castShadow = true })

  // ---- pistons and rods ----
  const pistonGeo = (() => {
    const p = [[0, 0.30], [0.36, 0.30], [0.40, 0.295], [0.422, 0.28], [0.422, 0.262], [0.408, 0.255], [0.408, 0.24], [0.422, 0.233], [0.422, 0.215], [0.408, 0.208], [0.408, 0.193], [0.422, 0.186],
      [0.422, -0.24], [0.40, -0.25], [0.37, -0.25], [0.37, 0.10], [0.0, 0.12]]
    return new THREE.LatheGeometry(p.map(([r, y]) => new THREE.Vector2(r, y)), 64)
  })()
  const rodGeo = (() => {
    const L = E.l, pts = []
    for (let i = 0; i <= 24; i++) { const a = lerp(58, 302, i / 24) * DEG; pts.push([0.31 * Math.cos(a), 0.31 * Math.sin(a)]) }
    pts.push([0.42, -0.115], [L - 0.24, -0.075])
    for (let i = 0; i <= 16; i++) { const a = lerp(-120, 120, i / 16) * DEG; pts.push([L + 0.15 * Math.cos(a), 0.15 * Math.sin(a)]) }
    pts.push([L - 0.24, 0.075], [0.42, 0.115])
    return extrudeYZ(pts, [circle(0, 0, 0.2, 40), circle(L, 0, 0.075, 24)], 0.18, 0.02)
  })()
  const pistons = [], rods = [], wristPins = []
  for (let i = 0; i < 4; i++) {
    const pg = new THREE.Group(); pg.position.x = XS[i]; group.add(pg)
    const pm = new THREE.Mesh(pistonGeo, mats.piston[i]); pm.castShadow = true; pg.add(pm)
    const wp = cyl(0.075, 0.62, steel, 20); pg.add(wp); wristPins.push(wp)
    pistons.push({ group: pg, mesh: pm })
    const rg = new THREE.Group(); rg.position.x = XS[i]; group.add(rg)
    const rm = new THREE.Mesh(rodGeo, mats.rod[i]); rm.castShadow = true; rg.add(rm)
    rods.push(rg)
  }
  const capMeshes = []; cutBlock.traverse(o => { if (o.isMesh) capMeshes.push(o) })
  const caps = stencilCaps(capMeshes, cutPlane, group)

  // ---- valvetrain ----
  const valveGeo = (headR) => new THREE.LatheGeometry([[0, -0.012], [headR, -0.012], [headR + 0.004, 0.005], [headR * 0.55, 0.06], [0.03, 0.2], [0.026, V.len], [0, V.len]].map(([r, y]) => new THREE.Vector2(r, y)), 40)
  const vInGeo = valveGeo(0.155), vExGeo = valveGeo(0.135)
  const springGeo = (() => { const pts = []; const turns = 6, n = 160; for (let k = 0; k <= n; k++) { const a = k / n * turns * Math.PI * 2; pts.push(new THREE.Vector3(0.075 * Math.cos(a), k / n, 0.075 * Math.sin(a))) } return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 320, 0.014, 6) })()
  const bucketGeo = new THREE.CylinderGeometry(0.115, 0.115, V.bucket, 32)
  const lobeGeo = f => {
    const pts = []
    for (let k = 0; k < 180; k++) { const psi = k * 2 * DEG, R = V.rb + f(mod(-2 * psi / DEG, 720)); pts.push([R * Math.cos(psi), R * Math.sin(psi)]) }
    return extrudeYZ(pts, [], 0.14, 0.012)
  }
  const lobeInGeo = lobeGeo(liftIn), lobeExGeo = lobeGeo(liftEx)
  const sides = [
    { name: 'in', sz: 1, dir: new THREE.Vector3(0, Math.cos(V.tilt), Math.sin(V.tilt)), geo: vInGeo, lobe: lobeInGeo, lift: liftIn, mat: mats.valveIn, lmat: mats.lobeIn },
    { name: 'ex', sz: -1, dir: new THREE.Vector3(0, Math.cos(V.tilt), -Math.sin(V.tilt)), geo: vExGeo, lobe: lobeExGeo, lift: liftEx, mat: mats.valveEx, lmat: mats.lobeEx },
  ]
  const valves = { in: [], ex: [] }, cams = {}
  const up = new THREE.Vector3(0, 1, 0)
  for (const S of sides) {
    const q = new THREE.Quaternion().setFromUnitVectors(up, S.dir)
    const seat0 = new THREE.Vector3(0, V.ySeat, S.sz * V.zSeat)
    const camC = seat0.clone().addScaledVector(S.dir, V.len + V.bucket + V.rb)
    S.camC = camC
    const shaft = new THREE.Group(); shaft.position.set(0, camC.y, camC.z); group.add(shaft)
    const sh = cyl(0.1, 4.1, steel, 24); sh.position.x = -0.05; shaft.add(sh)
    const spr = cyl(0.6, 0.08, steel, 48); spr.position.x = 2.3; shaft.add(spr)
    const nose = cyl(0.1, 0.32, steel, 24); nose.position.x = -2.15; spr.add(nose); nose.position.set(-0.16, 0, 0)
    for (let k = 0; k < 6; k++) { const s = cyl(0.12, 0.09, dark, 16); const a = k * Math.PI / 3; s.position.set(0, 0.36 * Math.cos(a), 0.36 * Math.sin(a)); spr.add(s) }
    cams[S.name] = { shaft, psiF: Math.atan2(-S.dir.z, -S.dir.y), sprocket: spr }
    for (let i = 0; i < 4; i++) for (const dx of [-V.dx, V.dx]) {
      const lobe = new THREE.Mesh(S.lobe, S.lmat[i]); lobe.position.x = XS[i] + dx; lobe.rotation.x = -OFF[i] / 2 * DEG; shaft.add(lobe)
      const vg = new THREE.Group(); vg.quaternion.copy(q); group.add(vg)
      const vm = new THREE.Mesh(S.geo, S.mat[i]); vg.add(vm)
      const bucket = new THREE.Mesh(bucketGeo, dark); bucket.position.y = V.len + V.bucket / 2; vg.add(bucket)
      const spring = new THREE.Mesh(springGeo, mats.spring); spring.position.y = 0.42; vg.add(spring)
      valves[S.name].push({ i, dx, group: vg, spring, seat: seat0.clone().setX(XS[i] + dx), lift: S.lift, dir: S.dir })
    }
  }
  // timing belt around the three sprockets (front, static loop) + spark plugs, coils, injectors, fuel rail
  const front = new THREE.Group(); front.name = 'frontDrive'; group.add(front)
  {
    const C = [[0, 0, 0.36], [sides[0].camC.y, sides[0].camC.z, 0.66], [sides[1].camC.y, sides[1].camC.z, 0.66]], P = []
    for (const [cy, cz, r] of C) for (let k = 0; k < 64; k++) { const a = k / 64 * Math.PI * 2; P.push([cz + r * Math.cos(a), cy + r * Math.sin(a)]) }
    // convex hull (monotone chain) in (z, y)
    P.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    const lo = [], hi = []
    for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p) }
    for (const p of [...P].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p) }
    const hull = lo.slice(0, -1).concat(hi.slice(0, -1))
    const belt = tube(hull.map(([z, y]) => [2.3, y, z]), 0.035, dark, { segs: 240, radial: 6, closed: true })
    front.add(belt)
  }
  const plugs = []
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group(); g.position.set(XS[i], 0, 0); group.add(g)
    const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.3, 24), mats.ceramic); ins.position.y = 3.15; g.add(ins)
    const hex = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 6), steel); hex.position.y = 2.52; g.add(hex)
    const thread = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 16), steel); thread.position.y = 2.4; g.add(thread)
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), mats.sparkTip[i]); tip.position.y = E.roof - 0.01; g.add(tip)
    const coil = new THREE.Mesh(roundedBox(0.26, 0.3, 0.26, 0.05), mats.coil); coil.position.y = 3.92; g.add(coil)
    const light = new THREE.PointLight(lin(0xcfe6ff), 0, 3.5, 2); light.position.y = E.roof - 0.1; g.add(light)
    plugs.push({ group: g, tip, light })
  }
  // intake runners (teal glass) from a plenum, exhaust primaries (warm glass) to a collector; ports into the head
  const paths = { in: [], ex: [], fuel: [] }
  const plenum = new THREE.Mesh(roundedBox(4.3, 0.75, 0.8, 0.3), XRAY.intake); plenum.position.set(0, 3.75, 2.25); group.add(plenum)
  const railPts = [[2.1, 3.42, 1.32], [-2.1, 3.42, 1.32]]
  group.add(tube(railPts, 0.06, mats.fuelRail, { segs: 8, radial: 12 }))
  const injectors = []
  for (let i = 0; i < 4; i++) {
    const x = XS[i]
    const inPts = [[x, 3.62, 2.0], [x, 3.42, 1.55], [x, 3.08, 1.02], [x, 2.72, 0.55], [x, V.ySeat + 0.05, V.zSeat + 0.03], [x, 2.05, 0.08]]
    paths.in.push(new THREE.CatmullRomCurve3(inPts.map(p => new THREE.Vector3(...p)), false, 'centripetal'))
    group.add(tube(inPts.slice(0, 5), 0.16, XRAY.intake, { segs: 48, radial: 20 }))
    const exPts = [[x, 2.02, -0.08], [x, V.ySeat + 0.05, -V.zSeat - 0.03], [x, 2.68, -0.6], [x, 2.62, -1.05], [x * 0.75, 2.1, -1.45], [x * 0.3, 1.2, -1.6], [0, 0.4, -1.6]]
    paths.ex.push(new THREE.CatmullRomCurve3(exPts.map(p => new THREE.Vector3(...p)), false, 'centripetal'))
    group.add(tube(exPts.slice(1), 0.15, XRAY.exhaust, { segs: 64, radial: 20 }))
    const inj = new THREE.Group(); inj.position.set(x, 3.24, 1.24); group.add(inj)
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.36, 16), mats.coil); inj.add(body)
    inj.lookAt(new THREE.Vector3(x, V.ySeat, V.zSeat).add(group.position)); inj.rotateX(Math.PI / 2)
    const nozzle = new THREE.Vector3(x, 3.0, 0.98)
    paths.fuel.push({ from: nozzle, to: new THREE.Vector3(x, V.ySeat + 0.06, V.zSeat + 0.02) })
    injectors.push(inj)
  }
  const collector = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.2, 24, 1, true), XRAY.exhaust); collector.position.set(0, -0.2, -1.6); group.add(collector)

  // ---- gas in the cylinders and flow particles ----
  const gasGeo = new THREE.CylinderGeometry(E.bore / 2 - 0.012, E.bore / 2 - 0.012, 1, 40)
  const gasMat = XS.map(() => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, clippingPlanes: [cutPlane] }))
  for (const m of gasMat) m.userData.glow = 'self'
  const gas = XS.map((x, i) => { const m = new THREE.Mesh(gasGeo, gasMat[i]); m.position.x = x; m.renderOrder = 3; group.add(m); return m })
  const R = rng(hashSeed('engine-flow'))
  const NI = 34, NF = 18, NE = 34, NC = 56
  const flows = makeParticles(4 * (NI + NF + NE + NC), { size: 0.085, boost: 2.4 })
  group.add(flows.points)
  const seeds = XS.map(() => ({
    in: Array.from({ length: NI }, () => [R(), R() - 0.5, R() - 0.5, 0.75 + 0.5 * R()]),
    fuel: Array.from({ length: NF }, () => [R(), R() - 0.5, R() - 0.5, 0.7 + 0.6 * R()]),
    ex: Array.from({ length: NE }, () => [R(), R() - 0.5, R() - 0.5, 0.75 + 0.5 * R()]),
    ch: Array.from({ length: NC }, (_, k) => [Math.sqrt(R()), R() * Math.PI * 2, R(), k % 4 === 0 ? 1 : 0, 0.7 + 0.6 * R()]),
  }))
  const C = { air: lin(FLOW.air), fuel: lin(FLOW.fuel), heat: lin(FLOW.heat), exhaust: lin(FLOW.exhaust), flash: lin(0xfff1c2), white: new THREE.Color(1, 1, 1) }
  const tmp = new THREE.Color(), tv = new THREE.Vector3()

  // ---- anchors ----
  const anchor = (name, x, y, z, parent = group) => { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); parent.add(o); return o }
  const anchors = {
    spark: XS.map((x, i) => anchor('spark' + i, x, E.roof + 0.02, 0)), plugTop: XS.map((x, i) => anchor('plugTop' + i, x, 3.7, 0)), cylTop: XS.map((x, i) => anchor('cylTop' + i, x, 4.5, 0)),
    intakeValve: XS.map((x, i) => anchor('intakeValve' + i, x + V.dx, 2.62, 0.32)), exhaustValve: XS.map((x, i) => anchor('exhaustValve' + i, x + V.dx, 2.62, -0.32)),
    camIn: anchor('camIn', 1.9, sides[0].camC.y + 0.2, sides[0].camC.z), camEx: anchor('camEx', 1.9, sides[1].camC.y + 0.2, sides[1].camC.z),
    piston: XS.map((x, i) => anchor('piston' + i, 0, 0.3, 0.35, pistons[i].group)),
    crankPin: XS.map((x, i) => anchor('crankPin' + i, 0, 0, 0, rods[i])),
    crank: anchor('crank', -1.0, 0, 0.3), flywheel: anchor('flywheel', -2.45, 0.7, 0.6), intakePort: anchor('intakePort', 1.47, 3.2, 1.2),
    exhaustPort: anchor('exhaustPort', 1.47, 2.6, -1.1), injector: anchor('injector', 1.47, 3.3, 1.25), plenum: anchor('plenum', 0.6, 4.1, 2.3),
  }

  let curLook = null
  const api = {
    // tint the glass housings (e.g. amber when the whole engine is "the part that acts" inside an x-ray car)
    setXrayTint(hex = 0x7fb4ff, gain = 1) { for (const k of ['block', 'head', 'liner']) { XRAY[k].uniforms.uColor.value.copy(lin(hex)); XRAY[k].uniforms.uGain.value = gain } },
    group, anchors, phase, liftIn, liftEx, XS, OFF, E, valves: V, cutPlane,
    stroke: (i, theta) => STROKES[Math.floor(phase(i, theta) / 180)],
    // look: 'xray' (glass block, all internals visible) or 'cutaway' (solid block clipped at cutX, hatched caps)
    setLook(l, x = cutX ?? XS[0]) {
      curLook = l
      const cut = l === 'cutaway'
      blockX.visible = !cut; pan.visible = !cut; for (const m of liners) m.visible = !cut
      cutBlock.visible = cut
      front.visible = !cut; pulley.visible = !cut; pulleyDisc.visible = !cut; crankSprocket.visible = !cut; snout.visible = !cut
      for (const S of Object.values(cams)) S.sprocket.visible = !cut
      cutLocal.constant = cut ? x : 1e3
      frontWeb.visible = !cut; frontMain.visible = !cut
      caps.visible = cut
      caps.place(new THREE.Vector3(cut ? x : 1e3, 0, 0), new THREE.Vector3(1, 0, 0))
    },
    // opts.glow: { i: cylinder index or 'all', auto: true } → amber glow on the parts acting in the current stroke
    update(theta, { glow = { cyl: 'all', k: 1 }, flows: showFlows = 1, camera = null, viewH = H } = {}) {
      group.updateMatrixWorld(true)
      cutPlane.copy(cutLocal).applyMatrix4(group.matrixWorld)
      const cutWorldX = curLook === 'cutaway' ? cutLocal.constant : 1e3
      crank.rotation.x = theta * DEG
      for (const S of sides) cams[S.name].shaft.rotation.x = cams[S.name].psiF + theta / 2 * DEG
      let pi = 0
      for (let i = 0; i < 4; i++) {
        const a = (theta - OFF[i]) * DEG, pinY = E.r * Math.cos(a), pinZ = E.r * Math.sin(a)
        const yp = pinY + Math.sqrt(E.l * E.l - pinZ * pinZ)
        pistons[i].group.position.y = yp
        rods[i].position.set(XS[i], pinY, pinZ); rods[i].rotation.x = Math.atan2(-pinZ, yp - pinY)
        const phi = phase(i, theta), st = Math.floor(phi / 180)
        // amber glow on the parts doing the work in this stroke
        const gk = (glow && (glow.cyl === 'all' || glow.cyl === i)) ? (glow.k ?? 1) : 0
        const li = liftIn(phi) / V.lift, le = liftEx(phi) / V.lift
        mats.valveIn[i].userData.glow(gk * li); mats.lobeIn[i].userData.glow(gk * li)
        mats.valveEx[i].userData.glow(gk * le); mats.lobeEx[i].userData.glow(gk * le)
        const pk = gk * (st === 1 ? smooth(180, 260, phi) : st === 2 ? 1 - smooth(470, 540, phi) : 0)
        mats.piston[i].userData.glow(pk); mats.rod[i].userData.glow(gk * (st === 2 ? 1 - smooth(470, 540, phi) : 0) * 0.8)
        // spark and combustion
        const spark = Math.exp(-Math.pow((phi - SPARK) / 5, 2))
        mats.sparkTip[i].emissiveIntensity = 30 * spark
        plugs[i].light.intensity = 5 * spark
        const heat = smooth(SPARK - 2, SPARK + 14, phi) * (1 - 0.75 * smooth(370, 540, phi)) * (1 - smooth(540, 620, phi))
        // gas column from the crown to the chamber roof
        const crown = yp + E.compH, h = Math.max(E.roof - crown, 0.01)
        gas[i].scale.y = h; gas[i].position.y = crown + h / 2
        const fill = phi < 360 ? clamp(CIN[Math.floor(phi)] / CIN[720] * 1.04) : 1
        const outF = phi >= V.exOpen ? clamp((CEX[Math.floor(phi)] - CEX[V.exOpen]) / CEX[720] * 1.05) : 0
        const comp = clamp((E.roof - 2.18 + 0.86) / h, 1, 8) // ≈ 1 at BDC → ~compression ratio at TDC
        if (phi < 360) { tmp.copy(C.air).lerp(C.fuel, 0.18); gasMat[i].color.copy(tmp).multiplyScalar(0.2 + 0.05 * comp); gasMat[i].opacity = 0.12 * fill * (0.7 + 0.08 * comp) }
        else if (phi < 540) { tmp.copy(C.flash).lerp(C.heat, smooth(SPARK + 4, 430, phi)); gasMat[i].color.copy(tmp).multiplyScalar(0.25 + 1.2 * heat); gasMat[i].opacity = 0.15 + 0.3 * heat }
        else { tmp.copy(C.exhaust).lerp(C.heat, 0.35 * heat); gasMat[i].color.copy(tmp).multiplyScalar(0.3); gasMat[i].opacity = 0.16 * (1 - outF) }
        // particles
        const sIn = cumAt(CIN, theta, i), sEx = cumAt(CEX, theta, i), sd = seeds[i]
        const visible = x => (x <= cutWorldX + 0.02 ? 1 : 0)
        for (const [k, s] of sd.in.entries()) {
          const u = fract(sIn * 0.010 * s[3] + s[0]), p = paths.in[i].getPointAt(u, tv)
          const a = showFlows * smooth(0, 0.08, u) * (1 - smooth(0.86, 1, u)) * smooth(0.02, 0.25, li)
          flows.set(pi++, p.x + s[1] * 0.16, p.y + s[2] * 0.12, p.z + s[1] * 0.1, C.air, a * visible(p.x + s[1] * 0.16), 0.9)
          void k
        }
        for (const s of sd.fuel) {
          const u = fract(sIn * 0.03 * s[3] + s[0]), f = paths.fuel[i]
          tv.lerpVectors(f.from, f.to, u)
          const spread = 0.14 * u
          const inj = phi < 150 || phi > 708 ? 1 : 0
          const a = showFlows * inj * smooth(0, 0.1, u) * (1 - smooth(0.8, 1, u)) * smooth(0.05, 0.3, li)
          flows.set(pi++, tv.x + s[1] * spread, tv.y + s[2] * spread * 0.6, tv.z + s[2] * spread * 0.5, C.fuel, a * visible(tv.x), 0.7)
        }
        for (const s of sd.ex) {
          const u = fract(sEx * 0.010 * s[3] + s[0]), p = paths.ex[i].getPointAt(u, tv)
          tmp.copy(C.heat).lerp(C.exhaust, smooth(0.1, 0.7, u))
          const a = showFlows * smooth(0, 0.06, u) * (1 - smooth(0.8, 1, u)) * smooth(0.02, 0.25, le)
          flows.set(pi++, p.x + s[1] * 0.16, p.y + s[2] * 0.12, p.z + s[2] * 0.1, tmp, a * visible(p.x + s[1] * 0.16), 1.0)
        }
        for (const s of sd.ch) {
          const [rr, ang, hh, isFuel, sz] = s
          const x = XS[i] + rr * 0.36 * Math.cos(ang), z = rr * 0.36 * Math.sin(ang), y = crown + 0.03 + hh * (h - 0.06)
          let a = 0
          if (phi < 360) { a = (1 - hh) < fill ? 1 : 0; tmp.copy(isFuel ? C.fuel : C.air); a *= 0.55 + 0.05 * comp }
          else if (phi < 540) { a = 0.9; tmp.copy(C.flash).lerp(C.heat, smooth(SPARK + 4, 430, phi)).multiplyScalar(0.55 + 1.0 * heat) }
          else { a = hh < 1 - outF ? 0.6 : 0; tmp.copy(C.exhaust).lerp(C.heat, 0.4 * heat) }
          flows.set(pi++, x, y, z, tmp, showFlows * a * visible(x), sz * 0.8)
        }
      }
      for (const v of [...valves.in, ...valves.ex]) {
        const phi = phase(v.i, theta), L = v.lift(phi)
        v.group.position.copy(v.seat).addScaledVector(v.dir, -L)
        // spring: fixed seat in the head (moves up by L in valve space) to the retainer on the stem
        v.spring.position.y = 0.42 + L
        v.spring.scale.y = 0.54 - L
      }
      if (camera) flows.commit(camera, viewH)
    },
  }
  api.setLook(look)
  group.traverse(o => { if (o.isMesh && !o.material.transparent && o.material.type !== 'ShaderMaterial') o.castShadow = true })
  return api
}
