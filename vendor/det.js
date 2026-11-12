// Deterministic helpers shared by compositions (spec 0002). Plain script, no deps.
// Load after clock.js:  <script src="clock.js"></script><script src="vendor/det.js"></script>
//
//   rng(seed)      → function returning floats in [0, 1); mulberry32, same sequence for the same seed
//   hashSeed(str)  → 32-bit unsigned seed from a string (FNV-1a), e.g. rng(hashSeed('s2-wheel'))
//   B(n)           → n beats in seconds; needs `const BEAT = 0.6` (seconds per beat) in the composition
//   eo(x), eio(x)  → ease-out cubic / ease-in-out cubic, input clamped to 0…1 (same as the 2D templates)
//
// Everything is assigned to window (not declared with var/let/const), so a composition that still
// declares its own `const eo = …` or `const B = …` keeps working: its own declaration shadows these.
// Never use Math.random() in a composition; use rng(seed).
(() => {
  const clamp01 = x => Math.min(1, Math.max(0, x))
  window.rng = seed => {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6D2B79F5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  window.hashSeed = str => {
    let h = 0x811c9dc5
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193)
    return h >>> 0
  }
  window.B = n => {
    // BEAT may be a top-level const in the composition (global lexical scope) or a window property.
    const beat = typeof BEAT === 'number' ? BEAT : window.BEAT // eslint-disable-line no-undef
    if (typeof beat !== 'number') throw new Error('det.js B(): define BEAT (seconds per beat) first')
    return n * beat
  }
  window.eo = x => 1 - Math.pow(1 - clamp01(x), 3)
  window.eio = x => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 }
})()
