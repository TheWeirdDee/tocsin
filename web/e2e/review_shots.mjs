// Capture the review screenshot set: node e2e/review_shots.mjs <outdir> [base]
import { chromium } from '@playwright/test'
const out = process.argv[2]
const base = process.argv[3] ?? 'http://127.0.0.1:8000'
const b = await chromium.launch()

async function page(w, h, scale = 1) {
  return b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale })
}
async function settle(p) { await p.waitForLoadState('networkidle'); await p.waitForTimeout(1200) }
async function scrollThrough(p) {
  const H = await p.evaluate(() => document.documentElement.scrollHeight)
  for (let y = 0; y < H; y += 700) { await p.evaluate((yy) => window.scrollTo(0, yy), y); await p.waitForTimeout(250) }
  await p.evaluate(() => window.scrollTo(0, 0)); await settle(p)
}
const shots = []
async function shot(p, name, full = false) { await p.screenshot({ path: `${out}/${name}.png`, fullPage: full }); shots.push(name) }

let p = await page(1440, 900)
await p.goto(base + '/'); await settle(p); await shot(p, '01-landing-above-fold')
await scrollThrough(p); await shot(p, '02-landing-full', true)
await p.goto(base + '/demo/test3?guide=alert&b=3'); await settle(p); await shot(p, '03-replay-alert', true)
await p.goto(base + '/demo/test2?cond=clean&b=1&t=30'); await settle(p); await shot(p, '04-replay-calibration', true)
await p.goto(base + '/demo/test2?guide=gaps&cond=gaps&b=1'); await settle(p); await shot(p, '05-missing-data', true)
await p.goto(base + '/analyze?sample=late'); await settle(p)
await p.getByRole('button', { name: 'Analyze reading' }).click(); await p.getByText(/Analyzed in/).waitFor({ timeout: 30000 }); await settle(p); await shot(p, '06-analysis-success', true)
await p.goto(base + '/analyze?sample=first'); await settle(p)
await p.getByLabel('Channel column (0 = first)').fill('9')
await p.getByRole('button', { name: 'Analyze reading' }).click(); await p.getByRole('alert').waitFor({ timeout: 30000 }); await settle(p); await shot(p, '07-analysis-validation-error', true)
await p.goto(base + '/evaluation'); await scrollThrough(p); await shot(p, '08-evaluation', true)
await p.close()

p = await page(390, 844, 2)
await p.goto(base + '/'); await settle(p); await shot(p, '09a-phone-landing-above-fold')
await p.goto(base + '/demo/test3?guide=alert&b=3'); await settle(p); await shot(p, '09b-phone-replay-alert', true)
await p.goto(base + '/analyze?sample=late'); await settle(p)
await p.getByRole('button', { name: 'Analyze reading' }).click(); await p.getByText(/Analyzed in/).waitFor({ timeout: 30000 }); await settle(p); await shot(p, '09c-phone-analysis', true)
await p.goto(base + '/evaluation#glance'); await settle(p); await shot(p, '09d-phone-evaluation-glance')
await p.goto(base + '/'); await settle(p)
await p.getByRole('button', { name: 'Open menu' }).click(); await p.waitForTimeout(300); await shot(p, '09e-phone-menu-open')
await p.close()
p = await page(820, 1180)
await p.goto(base + '/demo/test2?guide=miss&b=1'); await settle(p); await shot(p, '09f-tablet-missed-failure', true)
await b.close()
console.log(shots.join('\n'))
