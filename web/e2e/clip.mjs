import { chromium } from '@playwright/test'
const [,, path, sel, out, w] = process.argv
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: Number(w || 1440), height: 900 } })
await p.goto('http://127.0.0.1:8000/' + path, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.locator(sel).first().screenshot({ path: out })
await b.close()
