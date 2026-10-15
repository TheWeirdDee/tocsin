import { expect, test, type Page } from '@playwright/test'

const CROSS = process.env.E2E_CROSS_ORIGIN === '1'
const API = process.env.E2E_API_BASE ?? (CROSS ? 'http://127.0.0.1:8001' : '')

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'page must not scroll horizontally').toBeLessThanOrEqual(1)
}

async function openNav(page: Page) {
  const toggle = page.getByRole('button', { name: 'Open menu' })
  if (await toggle.isVisible()) await toggle.click()
}

test('landing explains the product and opens the demo', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Understand changes in machine vibration')
  await expect(page.getByText('Not a production monitoring system.')).toBeVisible()
  await expect(page.getByText(/of 2/).first()).toBeVisible() // measured results loaded from heldout.json
  // The demo video is a plain external link (no embedded player loads on the landing page).
  const demo = page.locator('.hero-cta').first().getByRole('link', { name: /Watch the demo/ })
  await expect(demo).toHaveAttribute('href', 'https://www.youtube.com/watch?v=oI8t5DeqMFU')
  await expect(demo).toHaveAttribute('target', '_blank')
  await expect(page.locator('iframe')).toHaveCount(0)
  await noHorizontalScroll(page)
  await page.locator('.hero-cta').getByRole('link', { name: /Explore a recorded test/ }).click()
  await expect(page).toHaveURL(/\/demo/)
  await expect(page.getByText('Recorded dataset replay. Not a live machine feed.')).toBeVisible()
})

test('replay controls: play, pause, step, reset, seek', async ({ page }) => {
  await page.goto('/demo/test2')
  const counter = page.getByText(/^Reading \d+ of 984$/)
  await expect(counter).toHaveText('Reading 1 of 984')
  await expect(page.locator('.badge', { hasText: 'Learning baseline' }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Next reading' }).click()
  await expect(counter).toHaveText('Reading 2 of 984')
  await page.getByRole('button', { name: 'Play' }).click()
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: 'Pause' }).click()
  const n = Number((await counter.textContent())!.match(/Reading (\d+)/)![1])
  expect(n).toBeGreaterThan(5)
  await page.getByRole('button', { name: 'Reset to start' }).click()
  await expect(counter).toHaveText('Reading 1 of 984')
  const slider = page.getByRole('slider', { name: 'Seek within recording' })
  await slider.fill('900')
  await expect(counter).toHaveText('Reading 901 of 984')
  await noHorizontalScroll(page)
})

test('direct URL with state survives refresh, and an alert has evidence', async ({ page }) => {
  await page.goto('/demo/test2?cond=clean&b=1&t=970')
  await expect(page.getByText('Reading 971 of 984')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Bearing 1', level: 2 })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Reading 971 of 984')).toBeVisible()
  const ev = page.locator('.evidence')
  await expect(ev).toContainText('Implicated band')
  await expect(ev).toContainText('Healthy reference')
  await expect(ev.locator('.ev-sentence')).not.toBeEmpty()
  await expect(page.locator('svg[aria-label^="Envelope spectrum"]')).toBeVisible({ timeout: 15_000 })
})

test('changing the complication loads that analysis and labels it', async ({ page }) => {
  await page.goto('/demo/test2?t=300')
  await page.getByRole('combobox', { name: 'Complication' }).selectOption('gaps')
  await expect(page).toHaveURL(/cond=gaps/)
  await expect(page.locator('.rb-prov')).toContainText('15% of readings lose a 40% contiguous block')
  await expect(page.getByText('Reading 301 of 984')).toBeVisible()
})

test('missing data shows no verdict and keeps the last valid state', async ({ page, request }) => {
  const rep = await (await request.get(`${API}/api/replay/test2?condition=gaps`)).json()
  const b = rep.bearings['1']
  const idx = b.valid.findIndex((v: number, i: number) => v === 0 && i > rep.n_ref + 5)
  expect(idx).toBeGreaterThan(0)
  await page.goto(`/demo/test2?cond=gaps&b=1&t=${idx}`)
  await expect(page.locator('.evidence .badge', { hasText: 'No valid data' })).toBeVisible()
  await expect(page.locator('.ev-sentence')).toContainText('no verdict for this reading')
})

test('evaluation shows held-out counts and comparison', async ({ page }) => {
  await page.goto('/evaluation')
  await expect(page.getByText('held-out failure events')).toBeVisible()
  const table = page.locator('#headline table')
  await expect(table).toContainText('TOCSIN')
  await expect(table).toContainText('RMS level alarm')
  await expect(table).toContainText('Isolation forest')
  await expect(page.locator('#robustness')).toContainText('20 dB SNR')
  await expect(page.locator('#reproduce')).toContainText('scripts/evaluate.py')
  await noHorizontalScroll(page)
})

test('deep link to an evaluation section scrolls there', async ({ page }) => {
  await page.goto('/evaluation#reproduce')
  await expect(page.locator('#reproduce')).toBeInViewport({ timeout: 10_000 })
})

test('data page lists provenance and discrepancies', async ({ page }) => {
  await page.goto('/data')
  await expect(page.getByText('Discrepancies found and how they were handled')).toBeVisible()
  await expect(page.locator('#runs table')).toContainText('6,324')
  await expect(page.locator('#geometry table')).toContainText('236.40')
  await noHorizontalScroll(page)
})

test('analyze a real sample reading end to end', async ({ page }) => {
  await page.goto('/analyze')
  await page.getByRole('button', { name: /near the recording endpoint/ }).click()
  await expect(page.getByText('ims_test2_2004.02.19.05.42.39.txt')).toBeVisible()
  await page.getByRole('button', { name: 'Analyze reading' }).click()
  await expect(page.getByText(/Analyzed in [\d.]+ ms/)).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.evidence')).toContainText('Implicated band')
  await noHorizontalScroll(page)
})

test('unknown route shows not-found page; navigation menu is reachable', async ({ page }) => {
  await page.goto('/no-such-page')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await openNav(page)
  await page.getByRole('link', { name: 'Results' }).click()
  await expect(page).toHaveURL(/\/evaluation$/)
})

test('keyboard: skip link and visible focus', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard test on desktop/tablet only')
  await page.goto('/')
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Skip to content' })
  await expect(skip).toBeFocused()
  const outline = await skip.evaluate((el) => getComputedStyle(el).outlineStyle)
  expect(outline).not.toBe('none')
})

test('frontend talks to the API origin it was built for (CORS when cross-origin)', async ({ page }) => {
  const seen: string[] = []
  page.on('response', (r) => { if (r.url().includes('/api/')) seen.push(`${r.status()} ${r.url()}`) })
  await page.goto('/demo/test2?t=10')
  await expect(page.getByText('Reading 11 of 984')).toBeVisible()
  expect(seen.length).toBeGreaterThan(0)
  for (const s of seen) expect(s.startsWith('200 ')).toBeTruthy()
  if (API) for (const s of seen) expect(s).toContain(`${API}/api/`)
})
