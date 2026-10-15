// Video capture of the live TOCSIN app. Real navigation and clicks only; nothing is mocked.
// Frames come from the Chrome DevTools screencast with their own timestamps; an event log records
// every action, the moment results appeared, and element boxes used for annotations.
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const OUT = process.argv[2]
const BASE = 'https://tocsin-phi.vercel.app'
const DPR = 16 / 9 // 1440x810 CSS px -> 2560x1440 frames
fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true })

const events = []
const now = () => Date.now() / 1000
const log = (type, label, extra = {}) => { events.push({ t: now(), type, label, ...extra }); console.log(type, label) }

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: DPR, colorScheme: 'dark' })
await ctx.addInitScript(() => {
  // A visible pointer that follows the real (Playwright-driven) mouse events, with a ring on each click.
  const css = `#__cur{position:fixed;z-index:2147483647;pointer-events:none;left:0;top:0;width:22px;height:22px;transform:translate(-3px,-2px);transition:none}
  #__cur svg{filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
  .__ring{position:fixed;z-index:2147483646;pointer-events:none;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:3px solid #ff8a1f;animation:__r .55s ease-out forwards}
  @keyframes __r{to{transform:scale(3.2);opacity:0}}`
  const add = () => {
    if (document.getElementById('__cur')) return
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s)
    const c = document.createElement('div'); c.id = '__cur'
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 13.8 L10.6 20.5 L13.4 19.2 L10.4 12.7 L16.5 12.4 Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>'
    c.style.left = '-50px'
    document.body.appendChild(c)
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px' }, true)
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div'); r.className = '__ring'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'
      document.body.appendChild(r); setTimeout(() => r.remove(), 700)
    }, true)
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', add); else add()
})
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))
const apiCalls = []
page.on('response', async (r) => {
  if (r.url().includes('/api/analyze')) {
    let body = null
    try { body = await r.json() } catch { /* ignore */ }
    apiCalls.push({ t: now(), url: r.url(), status: r.status(), body })
    log('api', 'analyze-response', { status: r.status() })
  }
})

// ---- screencast ----
const cdp = await ctx.newCDPSession(page)
const frames = []
let n = 0
cdp.on('Page.screencastFrame', async (f) => {
  const name = `f${String(n++).padStart(6, '0')}.jpg`
  fs.writeFileSync(path.join(OUT, 'frames', name), Buffer.from(f.data, 'base64'))
  frames.push({ name, t: f.metadata.timestamp ?? now(), sy: f.metadata.scrollOffsetY })
  try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }) } catch { /* closing */ }
})

let mx = 720, my = 405
async function moveTo(x, y, ms = 700) {
  const steps = Math.max(8, Math.round(ms / 16))
  const sx = mx, sy = my
  for (let i = 1; i <= steps; i++) {
    const k = i / steps, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
    await page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e)
    await page.waitForTimeout(ms / steps)
  }
  mx = x; my = y
}
async function box(loc) { const b = await loc.boundingBox(); return b && { x: b.x * DPR, y: b.y * DPR, w: b.width * DPR, h: b.height * DPR } }
async function mark(label, loc) { const b = await box(loc); log('mark', label, { box: b }); return b }
async function settle() {
  let last = -1
  for (let i = 0; i < 60; i++) { const y = await page.evaluate(() => scrollY); if (y === last) return; last = y; await page.waitForTimeout(120) }
}
async function click(label, loc) {
  await settle()
  await loc.scrollIntoViewIfNeeded()
  await settle()
  const b = await loc.boundingBox()
  await moveTo(b.x + b.width / 2, b.y + b.height / 2)
  await page.waitForTimeout(250)
  log('click', label, { box: await box(loc) })
  await page.mouse.down(); await page.mouse.up()
  await page.waitForTimeout(300)
  log('after_click', label, { url: page.url() })
}
async function center(loc, settle = 900) {
  await loc.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  await page.waitForTimeout(settle)
}
async function top(loc, settle = 900, offset = 90) {
  await loc.evaluate((el, o) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - o, behavior: 'smooth' }), offset)
  await page.waitForTimeout(settle)
}
const hold = (s) => page.waitForTimeout(s * 1000)

// ---- warm caches (not filmed) so the filmed loads reflect a normal second visit ----
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.goto(BASE + '/demo/test3?guide=alert&b=3', { waitUntil: 'networkidle' })
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await hold(2)

await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 2560, maxHeight: 1440, everyNthFrame: 1 })
log('start', 'capture')
await page.mouse.move(mx, my)

// ---- 1. Landing ----
log('chapter', 'landing')
await hold(1.5)
const heroPreview = page.getByText('40 h before the recording endpoint').first()
await mark('hero_h1', page.locator('h1').first())
await mark('hero_when', heroPreview)
await moveTo(1000, 430, 900)
await hold(3)
const preview = page.locator('section, div').filter({ has: page.getByText('BEARINGS BY PRIORITY', { exact: false }) }).filter({ has: heroPreview }).last()
await mark('hero_preview', preview)
await hold(6)

// ---- 2. Analyze a provided sample ----
log('chapter', 'analyze')
await click('nav_analyze', page.getByRole('banner').getByRole('link', { name: 'Analyze', exact: true }))
await page.getByRole('heading', { level: 1 }).waitFor()
await page.waitForLoadState('networkidle')
await hold(1)
await mark('scope_notice', page.locator('.notice.info').first())
await hold(3)
const sampleBtn = page.getByRole('button', { name: /near the recording endpoint/ })
await click('sample_late', sampleBtn)
await page.locator('.drop strong', { hasText: 'ims_test2_2004.02.19.05.42.39.txt' }).waitFor()
log('state', 'sample_loaded')
await hold(1.2)
await center(page.locator('.an-fields'))
await mark('drop_file', page.locator('.drop'))
await mark('fixed_fields', page.locator('.an-fields .field').nth(0))
await mark('fixed_rpm', page.locator('.an-fields .field').nth(1))
await hold(2)
await moveTo(...(await (async () => { const b = await page.locator('.an-fields .field').nth(2).boundingBox(); return [b.x + b.width / 2, b.y + b.height - 14] })()), 600)
await mark('column', page.locator('.an-fields .field').nth(2))
await hold(1.5)
const refSel = page.locator('.an-ref select')
const b = await refSel.boundingBox(); await moveTo(b.x + b.width / 2, b.y + b.height / 2, 600)
// The reference already defaults to Test 2 bearing 1; selecting it explicitly shows nothing is changed off-screen.
await refSel.selectOption('test2:1')
log('state', 'reference', { value: await refSel.inputValue(), text: await refSel.locator('option:checked').innerText() })
await mark('reference', page.locator('.an-ref'))
await hold(2)
await click('analyze_btn', page.getByRole('button', { name: /Analyze reading/ }))
await page.getByText(/Analyzed in/).waitFor({ timeout: 60000 })
log('state', 'result_shown')
await hold(0.8)
await top(page.locator('.an-inputs'), 1200, 110)
await mark('result_inputs', page.locator('.an-inputs'))
await mark('result_panel', page.locator('.panel.evidence'))
await mark('result_head', page.locator('.panel.evidence .panel-head'))
await mark('result_score', page.locator('.ev-grid > div', { hasText: 'Score vs threshold' }))
await mark('result_prom', page.locator('.ev-grid > div', { hasText: 'Prominence / reference' }))
await mark('result_sentence', page.locator('.panel.evidence .ev-sentence'))
await moveTo(1100, 700, 700)
await hold(9)
await top(page.locator('.panel', { has: page.getByText('Envelope spectrum of the uploaded reading') }), 1200, 90)
await mark('upload_spectrum', page.locator('.panel', { has: page.getByText('Envelope spectrum of the uploaded reading') }))
await hold(5)

// ---- 3. Replay: understand an alert ----
log('chapter', 'replay')
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
await hold(1)
await click('nav_replay', page.getByRole('banner').getByRole('link', { name: /Explore the replay/ }))
await page.locator('.evidence .badge', { hasText: 'Alert' }).first().waitFor({ timeout: 30000 })
log('state', 'alert_loaded', { url: page.url() })
await hold(1)
await mark('replay_banner', page.getByText('Recorded dataset replay. Not a live machine feed.').first())
await mark('guide_note', page.locator('.guide-note'))
await mark('guide_concluded', page.getByText(/ALERT at 16 Apr 2004, 10:42/).first())
await moveTo(900, 560, 800)
await hold(6)
await top(page.locator('.panel.evidence').first(), 1300, 90)
await mark('evidence', page.locator('.panel.evidence').first())
await mark('ev_prom', page.locator('.panel.evidence').first().locator('.ev-grid > div', { hasText: 'Band prominence' }))
await mark('ev_ref', page.locator('.panel.evidence').first().locator('.ev-grid > div', { hasText: 'Healthy reference' }))
await mark('ev_persist', page.locator('.panel.evidence').first().locator('.ev-grid > div', { hasText: 'Persistence' }))
await mark('ev_time', page.locator('.panel.evidence').first().locator('.ev-grid > div', { hasText: 'Recording time' }))
await mark('prio_list', page.locator('.prio-list').first())
await hold(9)
const trend = page.locator('.panel', { has: page.getByText('Defect-band score over time') }).first()
await top(trend, 1300, 90)
await mark('trend', trend)
await hold(5)
const spec = page.locator('.panel', { has: page.getByText(/^Envelope spectrum$/) }).first()
await top(spec, 1300, 90)
await mark('spectrum', spec)
await mark('spectrum_sub', spec.locator('.panel-sub').first())
await hold(7)

// ---- 4. Missing data ----
log('chapter', 'gaps')
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
await hold(1)
await click('tab_gaps', page.getByRole('link', { name: 'See missing-data handling' }))
await page.locator('.evidence .badge', { hasText: 'No valid data' }).first().waitFor({ timeout: 30000 })
log('state', 'gaps_loaded', { url: page.url() })
await hold(1)
await mark('gaps_note', page.locator('.guide-note'))
await mark('gaps_complication', page.locator('select').nth(1))
await hold(5)
await top(page.locator('.panel.evidence').first(), 1300, 90)
await mark('gaps_evidence', page.locator('.panel.evidence').first())
await mark('gaps_reason', page.locator('.panel.evidence').first().locator('.ev-sentence').first())
await mark('gaps_lastvalid', page.locator('.panel.evidence').first().getByText(/Values below are the last valid measurement/))
await moveTo(1000, 650, 700)
await hold(10)

// ---- 5. Evaluation ----
log('chapter', 'evaluation')
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
await hold(1)
await click('tab_compare', page.getByRole('link', { name: 'Compare the methods' }))
await page.locator('#glance').waitFor()
await hold(1.5)
await top(page.locator('#glance'), 1300, 80)
await mark('glance', page.locator('#glance'))
await mark('glance_damaged', page.locator('#glance').getByText(/1 of 2 for TOCSIN/).first())
await mark('glance_undamaged', page.locator('#glance').getByText(/4 of 6 for TOCSIN/).first())
await mark('glance_when', page.locator('#glance').getByText(/Test 3 bearing 3: TOCSIN 40 h/).first())
await hold(10)
const table = page.locator('table', { has: page.getByText('TOCSIN (submitted)') }).first()
await top(table, 1300, 160)
await mark('det_table', table)
await mark('row_tocsin', table.locator('tr', { hasText: 'TOCSIN (submitted)' }))
await mark('row_a1', table.locator('tr', { hasText: 'Simpler variant A1' }))
await mark('col_v10', table.locator('th', { hasText: 'v1.0' }).first())
await hold(10)

// ---- 6. Close ----
log('chapter', 'close')
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
await hold(1)
await click('brand', page.getByRole('link', { name: 'TOCSIN home' }))
await page.locator('h1').first().waitFor()
await hold(1)
await moveTo(1300, 760, 700)
await hold(6)
const foot = page.getByText(/RUNNING VERSIONS/i).first()
await center(foot, 1500)
await mark('versions', foot.locator('xpath=..'))
await hold(4)

log('end', 'capture')
await cdp.send('Page.stopScreencast')
await page.waitForTimeout(500)
fs.writeFileSync(path.join(OUT, 'capture.json'), JSON.stringify({ base: BASE, dpr: DPR, frames, events, apiCalls, pageErrors, captured: new Date().toISOString() }, null, 1))
console.log('frames', frames.length, 'errors', pageErrors)
await browser.close()
