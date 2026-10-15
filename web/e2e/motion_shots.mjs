// Record the landing-page motion and capture reduced-motion evidence:
//   node e2e/motion_shots.mjs <outdir> [base]
// Writes desktop and phone recordings (webm), still frames, and motion-report.json.
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const out = process.argv[2]
const base = process.argv[3] ?? 'http://127.0.0.1:8000'
fs.mkdirSync(out, { recursive: true })
const b = await chromium.launch()
const report = {}

async function scrollSlowly(p, step, pause) {
  // the page grows as data-driven sections load, so the end is re-measured on every step
  for (let y = 0; y <= await p.evaluate(() => document.documentElement.scrollHeight - innerHeight) + step; y += step) {
    await p.evaluate((yy) => window.scrollTo({ top: yy }), y); await p.waitForTimeout(pause)
  }
}

async function record(name, viewport, scale) {
  const dir = path.join(out, `${name}-video`)
  const ctx = await b.newContext({ viewport, deviceScaleFactor: scale, recordVideo: { dir, size: viewport } })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(String(e)))
  await p.goto(base + '/')
  await p.waitForTimeout(250)
  await p.screenshot({ path: path.join(out, `${name}-hero-entering.png`) })
  await p.waitForTimeout(3200) // hero entrance, then the preview's focus cues once its data arrives
  await p.screenshot({ path: path.join(out, `${name}-hero-settled.png`) })
  await scrollSlowly(p, viewport.height * 0.45, 650)
  await p.waitForTimeout(800)
  // after scrolling through, every revealed element must be fully visible
  report[name] = await p.evaluate(() => {
    // HTML elements only: chart SVG marks are translucent by design
    const els = [...document.querySelectorAll('.landing .sec *, .landing .hero *')].filter((e) => !(e instanceof SVGElement))
    const hidden = els.filter((e) => getComputedStyle(e).opacity !== '1' && e.getBoundingClientRect().height > 0).map((e) => `${e.tagName}.${e.className}`)
    return { hiddenAfterScroll: hidden.slice(0, 10), scrollTriggers: document.documentElement.dataset.scrollTriggers }
  })
  report[name].pageErrors = errors
  await ctx.close()
  const vid = fs.readdirSync(dir).find((f) => f.endsWith('.webm'))
  fs.renameSync(path.join(dir, vid), path.join(out, `${name}.webm`))
  fs.rmSync(dir, { recursive: true })
}

await record('desktop', { width: 1440, height: 900 }, 1)
await record('phone', { width: 390, height: 844 }, 1)

// Steps section mid-reveal (desktop), to show the connector and paired rows.
{
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
  await p.goto(base + '/')
  await p.waitForTimeout(1500)
  await p.locator('.steps-split').scrollIntoViewIfNeeded()
  await p.evaluate(() => window.scrollBy(0, -120))
  await p.waitForTimeout(700)
  await p.screenshot({ path: path.join(out, 'desktop-steps-revealing.png') })
  await p.waitForTimeout(1500)
  await p.screenshot({ path: path.join(out, 'desktop-steps-settled.png') })
  await p.close()
}

// Reduced motion: nothing animates, so every element is visible at once without scrolling.
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const p = await ctx.newPage()
  await p.goto(base + '/')
  await p.waitForTimeout(1500)
  report.reducedMotion = await p.evaluate(() => {
    const els = [...document.querySelectorAll('.landing .sec *, .landing .hero *')].filter((e) => !(e instanceof SVGElement))
    return {
      notFullyVisible: els.filter((e) => getComputedStyle(e).opacity !== '1').map((e) => `${e.tagName}.${e.className}`),
      scrollTriggers: document.documentElement.dataset.scrollTriggers,
      connector: getComputedStyle(document.querySelector('.steps-split .steps')).getPropertyValue('--connector') || '(unset: drawn)',
    }
  })
  await p.screenshot({ path: path.join(out, 'reduced-motion-full.png'), fullPage: true })
  await ctx.close()
}

// Repeated route changes and back/forward must not duplicate ScrollTriggers.
{
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
  const counts = []
  await p.goto(base + '/')
  await p.waitForTimeout(1500)
  counts.push(await p.evaluate(() => document.documentElement.dataset.scrollTriggers))
  for (let i = 0; i < 3; i++) {
    await p.getByRole('link', { name: 'Results' }).first().click()
    await p.waitForTimeout(600)
    counts.push(await p.evaluate(() => `away:${document.documentElement.dataset.scrollTriggers}`))
    await p.goBack()
    await p.waitForTimeout(1500)
    counts.push(await p.evaluate(() => document.documentElement.dataset.scrollTriggers))
  }
  report.routeChanges = counts
  await p.close()
}

await b.close()
fs.writeFileSync(path.join(out, 'motion-report.json'), JSON.stringify(report, null, 1))
console.log(JSON.stringify(report, null, 1))
