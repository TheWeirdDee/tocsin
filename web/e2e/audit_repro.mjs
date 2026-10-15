// Reproduce audit findings TC-01/03/05/06/07/09 against a deployed or local frontend.
// node e2e/audit_repro.mjs <baseURL> <outJson>
import { chromium } from '@playwright/test'
import fs from 'node:fs'
const base = process.argv[2] ?? 'https://tocsin-phi.vercel.app'
const out = process.argv[3]
const res = {}
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

async function text(sel) { return (await page.locator(sel).first().textContent().catch(() => null)) ?? null }

// TC-01 malformed cursors
res.tc01 = {}
for (const t of ['1.5', '-4', 'abc', '99999']) {
  errors.length = 0
  await page.goto(`${base}/demo/test3?cond=clean&b=3&t=${t}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const hasNav = await page.locator('header nav').count()
  const hasControls = await page.getByRole('button', { name: /^(Play|Pause)$/ }).count()
  res.tc01[t] = { usable: hasNav > 0 && hasControls > 0, url: page.url(), pageErrors: errors.slice(0, 2) }
}

// TC-03 calibration-period evidence at reading 1
await page.goto(`${base}/demo/test2?cond=clean&b=1&t=0`, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
res.tc03 = { evidenceText: (await text('.evidence'))?.slice(0, 600), priorityText: (await text('.prio-list'))?.slice(0, 300) }

// TC-07 retained values during missing data
const rep = await (await page.request.get('https://tocsin-production.up.railway.app/api/replay/test2?condition=gaps')).json()
const idx = rep.bearings['1'].valid.findIndex((v, i) => v === 0 && i > 100)
await page.goto(`${base}/demo/test2?cond=gaps&b=1&t=${idx}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
res.tc07 = { idx, evidenceText: (await text('.evidence'))?.slice(0, 500) }

// TC-09 spectrum during playback at 16 readings/s
await page.goto(`${base}/demo/test2?cond=clean&b=1&t=200`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
const specBefore = await text('.panel:has(h3:text("Envelope spectrum")) .panel-sub')
let specRequests = 0
page.on('request', (r) => { if (r.url().includes('/api/spectrum/')) specRequests++ })
await page.getByRole('button', { name: 'Play' }).click()
await page.waitForTimeout(2500)
const readingDuring = await text('.rb-meta .num:nth-child(2)')
const specDuring = await text('.panel:has(h3:text("Envelope spectrum")) .panel-sub')
await page.getByRole('button', { name: 'Pause' }).click()
res.tc09 = { specBefore, readingDuring, specDuring, spectrumRequestsDuring2_5sPlay: specRequests }

// TC-06 run switch shows stale content while loading
await page.goto(`${base}/demo/test2?cond=clean&b=1&t=500`, { waitUntil: 'networkidle' })
await page.route('**/api/replay/test3**', async (r) => { await new Promise((z) => setTimeout(z, 2500)); await r.continue().catch(() => {}) })
await page.getByRole('combobox', { name: 'Recording' }).selectOption('test3')
await page.waitForTimeout(700)
res.tc06 = { selected: await page.getByRole('combobox', { name: 'Recording' }).inputValue(), shownTime: await text('.rb-meta strong'), priorityHeader: await text('.panel-head .panel-sub') }
await page.waitForTimeout(3000); await page.unrouteAll({ behavior: 'ignoreErrors' })

// TC-05 stale analyze result after input change
await page.goto(`${base}/analyze`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /first reading/ }).click()
await page.getByRole('button', { name: /Analyze (snapshot|reading)/ }).click()
await page.getByText(/Analyzed in/).waitFor({ timeout: 30000 })
await page.getByLabel(/Channel column/).fill('2')
await page.waitForTimeout(300)
res.tc05 = { resultStillShown: await page.getByText(/Analyzed in/).count() > 0, staleWarning: await page.getByText(/inputs have changed|inputs changed/i).count() > 0 }

await b.close()
fs.writeFileSync(out, JSON.stringify({ base, time: new Date().toISOString(), ...res }, null, 1))
console.log(JSON.stringify(res, null, 1))
