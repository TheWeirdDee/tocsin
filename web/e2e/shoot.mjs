// Capture review screenshots of real pages: node e2e/shoot.mjs <outdir> [base]
import { chromium } from '@playwright/test'
const out = process.argv[2]
const base = process.argv[3] ?? 'http://127.0.0.1:8000'
const shots = [
  ['landing', '/', 1440, 900, true],
  ['demo-start', '/demo/test2?cond=clean&t=0', 1440, 900, false],
  ['demo-test3-alert', '/demo/test3?guide=alert&b=3', 1440, 1000, true],
  ['demo-baselining', '/demo/test2?cond=clean&b=1&t=0', 1440, 1000, true],
  ['demo-gaps', '/demo/test2?guide=gaps&cond=gaps&b=1', 1440, 1000, true],
  ['demo-test2-miss', '/demo/test2?guide=miss&b=1', 1440, 1000, true],
  ['evaluation', '/evaluation', 1440, 900, true],
  ['data', '/data', 1440, 900, true],
  ['analyze', '/analyze', 1440, 900, false],
  ['landing-phone', '/', 390, 844, true],
  ['demo-phone', '/demo/test3?cond=clean&b=3&t=6100', 390, 844, true],
  ['evaluation-phone', '/evaluation', 390, 844, true],
  ['demo-tablet', '/demo/test3?cond=gaps&b=3&t=6100', 820, 1180, true],
]
const browser = await chromium.launch()
for (const [name, path, w, h, full] of shots) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1 })
  await page.goto(base + path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: full })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  console.log(name, 'overflow', overflow)
  await page.close()
}
await browser.close()
