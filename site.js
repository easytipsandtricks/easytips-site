// site.js — boot module (spec 0006). Small on purpose: nav state, reveal-on-scroll, card tilt, and the 3D story, which is
// imported only in WebGL mode, after the page has loaded and painted. No cookies, storage, analytics or network calls.
const d = document.documentElement
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

// glassy nav gets a stronger background once the page scrolls
const nav = document.getElementById('nav')
if (nav) { const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8); addEventListener('scroll', onScroll, { passive: true }); onScroll() }

// reveal panels and cards as they enter (content stays visible without JS or with reduced motion)
if (!reduced && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }, { rootMargin: '0px 0px -6% 0px' })
  const els = document.querySelectorAll('.reveal')
  // anything already on screen shows immediately (no flash)
  for (const el of els) { const r = el.getBoundingClientRect(); if (r.top < innerHeight && r.bottom > 0) el.classList.add('in'); else io.observe(el) }
  d.classList.add('reveal-on')
}

// hover tilt on the video cards (mouse/pen only)
if (!reduced && matchMedia('(hover: hover) and (pointer: fine)').matches) {
  for (const a of document.querySelectorAll('.vlink')) {
    a.addEventListener('pointermove', e => {
      const r = a.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height
      a.classList.add('tilting')
      a.style.setProperty('--ry', ((x - 0.5) * 10).toFixed(2) + 'deg'); a.style.setProperty('--rx', ((0.5 - y) * 8).toFixed(2) + 'deg')
      a.style.setProperty('--gx', (x * 100).toFixed(1) + '%'); a.style.setProperty('--gy', (y * 100).toFixed(1) + '%')
    })
    a.addEventListener('pointerleave', () => { a.classList.remove('tilting'); a.style.setProperty('--rx', '0deg'); a.style.setProperty('--ry', '0deg') })
  }
}

// the 3D story: lazy-start after first paint, fall back to the stills on any failure
const canvas = document.getElementById('stage')
if (canvas && d.classList.contains('gl')) {
  const fallback = err => { console.info('3D story off, showing stills:', err && err.message || err); d.classList.remove('gl', 'gl-ready'); d.classList.add('static') }
  // WebGL2 can exist as an API yet be blocked (GPU blocklist, policy): probe a real context before downloading three.js
  const canGL = () => { try { const g = document.createElement('canvas').getContext('webgl2'); if (!g) return false; const x = g.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); return true } catch { return false } }
  const start = () => !canGL() ? fallback(new Error('no WebGL2 context')) : import('./js/story.js')
    .then(m => m.mount({ canvas, chapters: [...document.querySelectorAll('.story > [data-act]')], cover: document.getElementById('videos'), onReady: () => d.classList.add('gl-ready') }))
    .catch(fallback)
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); fallback(new Error('WebGL context lost')) })
  const later = () => requestAnimationFrame(() => ('requestIdleCallback' in window ? requestIdleCallback(start, { timeout: 1200 }) : setTimeout(start, 120)))
  if (document.readyState === 'complete') later(); else addEventListener('load', later, { once: true })
}
