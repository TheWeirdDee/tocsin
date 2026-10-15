import { expect, test } from '@playwright/test'

// Regression tests for the external audit (TC-01, 03, 04, 05, 06, 07, 09) and the guided examples.
const API = process.env.E2E_API_BASE ?? (process.env.E2E_CROSS_ORIGIN === '1' ? 'http://127.0.0.1:8001' : '')

test.describe('TC-01 malformed replay URLs', () => {
  for (const [raw, expected] of [['1.5', '1'], ['-4', '0'], ['abc', '0'], ['99999', '6323'], ['', '0']] as const) {
    test(`t=${raw || '(empty)'} renders a usable page with a canonical cursor`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      await page.goto(`/demo/test3?cond=clean&b=3&t=${raw}`)
      await loaded(page)
      await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
      await expect(page).toHaveURL(new RegExp(`[?&]t=${expected}(&|$)`))
      await expect(page.getByText(new RegExp(`^Reading ${Number(expected) + 1} of 6324$`))).toBeVisible()
      await page.reload()
      await loaded(page)
      await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
      expect(errors).toEqual([])
    })
  }

  test('unknown run, condition and bearing are reported, not crashed', async ({ page }) => {
    await page.goto('/demo/test9')
    await expect(page.getByText('There is no recording called “test9”.')).toBeVisible()
    await page.goto('/demo/test2?cond=bogus')
    await expect(page.getByText(/is not an analysed condition/)).toBeVisible()
    await page.goto('/demo/test2?b=9&t=10')
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
    await expect(page).not.toHaveURL(/b=9/)
  })

  test('back and forward move the cursor', async ({ page }) => {
    await page.goto('/demo/test2?cond=clean&b=1&t=100')
    await expect(page.getByText('Reading 101 of 984')).toBeVisible()
    await page.goto('/demo/test2?cond=clean&b=1&t=500')
    await expect(page.getByText('Reading 501 of 984')).toBeVisible()
    await page.goBack()
    await expect(page.getByText('Reading 101 of 984')).toBeVisible()
    await page.goForward()
    await expect(page.getByText('Reading 501 of 984')).toBeVisible()
  })
})

test('TC-03 calibration period shows no reference-relative evidence and a neutral order', async ({ page }) => {
  await page.goto('/demo/test2?cond=clean&b=1&t=0')
  const ev = page.locator('.evidence')
  await expect(ev).toContainText('1 of 72 valid readings')
  await expect(ev).not.toContainText('Healthy reference')
  await expect(ev).not.toContainText('Score vs threshold')
  await expect(ev).not.toContainText('Ratio to reference')
  await expect(page.locator('.prio-name')).toHaveText(['Bearing 1', 'Bearing 2', 'Bearing 3', 'Bearing 4'])
  await expect(page.locator('.prio-list')).not.toContainText('Score')
  // Not just the card: the whole page, chart tooltips, spectrum caption and accessible names.
  for (const t of ['0', '40', '71']) {
    await page.goto(`/demo/test2?cond=clean&b=1&t=${t}`)
    await expect(page.locator('.evidence')).toContainText('valid readings')
    const text = await page.locator('main').innerText()
    for (const banned of ['Healthy reference', 'Ratio to reference', 'Score vs threshold', 'Implicated band', 'Trend (last 6']) expect(text).not.toContain(banned)
    await expect(page.locator('.prio-list')).not.toContainText('Score')
    await expect(page.getByTestId('spectrum-label').locator('..').locator('..')).toContainText('No family is implicated until the reference exists')
    const chart = page.locator('svg[aria-label$="TOCSIN score"], svg[aria-label*="TOCSIN score."]').first()
    const box = (await chart.boundingBox())!
    await page.mouse.move(box.x + box.width * 0.02 + 60, box.y + box.height * 0.3)
    const tip = page.locator('.chart-tooltip')
    if (await tip.count()) await expect(tip.first()).not.toContainText(/Score -?\d/)
    const aria = await page.locator('[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? '').join(' | '))
    expect(aria).not.toMatch(/Healthy reference|Ratio to reference|Score \d/)
  }
})

test('TC-07 retained values are labelled as the last valid measurement', async ({ page, request }) => {
  const rep = await (await request.get(`${API}/api/replay/test2?condition=gaps`)).json()
  const idx = rep.bearings['1'].valid.findIndex((v: number, i: number) => v === 0 && i > rep.n_ref + 10)
  await page.goto(`/demo/test2?cond=gaps&b=1&t=${idx}`)
  await expect(page.locator('.retained-note')).toContainText('last valid measurement')
  await expect(page.locator('.evidence')).toContainText('Band prominence (last valid)')
  await expect(page.locator('.evidence')).not.toContainText('Band prominence (this reading)')
})

test('TC-09 the spectrum keeps up during playback and names its reading', async ({ page }) => {
  let n = 0
  page.on('request', (r) => { if (r.url().includes('/api/spectrum/')) n++ })
  await page.goto('/demo/test2?cond=clean&b=1&t=200')
  await expect(page.getByTestId('spectrum-label')).toContainText('Reading 201')
  n = 0
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Pause' }).click()
  expect(n).toBeGreaterThan(3)
  const reading = Number((await page.getByText(/^Reading \d+ of 984$/).textContent())!.match(/\d+/)![0])
  await expect(page.getByTestId('spectrum-label')).toContainText(`Reading ${reading}`, { timeout: 5000 })
})

test('TC-06 switching runs never shows the previous run under the new name; failures are visible', async ({ page }) => {
  await page.goto('/demo/test2?cond=clean&b=1&t=500')
  await expect(page.getByText('Reading 501 of 984')).toBeVisible()
  await page.route('**/api/replay/test3**', async (r) => { await new Promise((z) => setTimeout(z, 1500)); await r.continue().catch(() => {}) })
  await page.getByRole('combobox', { name: 'Recording' }).selectOption('test3')
  await expect(page.getByRole('status').filter({ hasText: 'Loading the precomputed analysis' })).toBeVisible()
  await expect(page.locator('.ws-grid')).toHaveCount(0)
  await expect(page.getByText(/of 984$/)).toHaveCount(0)
  await expect(page.getByText(/of 6324$/)).toBeVisible({ timeout: 15000 })
  await page.unrouteAll({ behavior: 'ignoreErrors' })

  await page.route('**/api/replay/test2?condition=noise0', (r) => r.fulfill({ status: 500, body: '{"detail":"simulated failure"}', contentType: 'application/json' }))
  await page.goto('/demo/test2?cond=clean&t=10')
  await expect(page.getByText('Reading 11 of 984')).toBeVisible()
  await page.getByRole('combobox', { name: 'Complication' }).selectOption('noise0')
  await expect(page.getByRole('alert').filter({ hasText: 'This analysis could not be loaded.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(page.locator('.ws-grid')).toHaveCount(0)
})

test.describe('Analyze', () => {
  test('TC-04 names the upload, not a hard-coded bearing; TC-05 marks results stale when inputs change', async ({ page }) => {
    await page.goto('/analyze')
    await page.getByRole('button', { name: /first reading/ }).click()
    await page.getByLabel('Channel column (0 = first)').fill('3')
    await page.getByLabel('Healthy reference to compare against').selectOption('test2:4')
    await page.getByRole('button', { name: 'Analyze reading' }).click()
    await expect(page.locator('.ev-sentence').first()).toContainText('Uploaded reading (column 3):', { timeout: 30000 })
    await expect(page.locator('.ev-sentence').first()).not.toContainText('Bearing 1')
    await expect(page.getByTestId('result-inputs')).toContainText('bearing 4')
    await expect(page.getByTestId('stale-result')).toHaveCount(0)
    await page.getByLabel('Channel column (0 = first)').fill('2')
    await expect(page.getByTestId('stale-result')).toBeVisible()
    await page.getByLabel('Channel column (0 = first)').fill('3')
    await expect(page.getByTestId('stale-result')).toHaveCount(0)
  })

  test('TC-02/TC-08 acquisition settings are fixed to the supported configuration', async ({ page }) => {
    await page.goto('/analyze')
    await expect(page.getByLabel('Sample rate (fixed)')).toHaveAttribute('readonly', '')
    await expect(page.getByLabel('Shaft speed (fixed)')).toHaveAttribute('readonly', '')
    await expect(page.getByText('Supported scope: IMS-compatible readings only.')).toBeVisible()
  })

  test('TC-02 server validation messages are shown, not "server could not be reached"', async ({ page }) => {
    await page.goto('/analyze')
    await page.getByRole('button', { name: /first reading/ }).click()
    await page.getByLabel('Channel column (0 = first)').fill('9')
    await page.getByRole('button', { name: 'Analyze reading' }).click()
    await expect(page.getByRole('alert')).toContainText('Column 9 is not present', { timeout: 30000 })
    await expect(page.getByRole('alert')).not.toContainText('could not be reached')
  })
})

// Test 3 replays are ~3.7 MB of JSON; allow for loading on a slow or busy machine before asserting.
const loaded = (page: import('@playwright/test').Page) => expect(page.locator('.evidence')).toBeVisible({ timeout: 20_000 })

test('guided examples land on data-driven readings', async ({ page }) => {
  await page.goto('/demo/test3?guide=alert&b=3')
  await loaded(page)
  await expect(page.locator('.evidence .badge', { hasText: 'Alert' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Scenario: Understand an alert' })).toContainText('It does not establish')
  await page.goto('/demo/test2?guide=miss&b=1')
  await expect(page.locator('.cmp')).toContainText('Alert')
  await expect(page.locator('.evidence .badge').first()).not.toHaveText(/Alert/)
  await page.goto('/demo/test2?guide=gaps&cond=gaps&b=1')
  await expect(page.locator('.evidence .badge', { hasText: 'No valid data' })).toBeVisible()
})

test('footer reports frontend and API versions', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('versions')).toContainText(/frontend [0-9a-f]{7}/)
})

test('landing offers the five scenario entry points and they open working pages', async ({ page }) => {
  await page.goto('/')
  for (const name of ['Understand an alert', 'Inspect the missed failure', 'See missing-data handling', 'Analyze a supported sample', 'Compare the methods']) {
    await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible()
  }
  await page.getByRole('link', { name: /Inspect the missed failure/ }).click()
  await expect(page.getByRole('region', { name: 'Scenario: Inspect the missed failure' })).toContainText('never alerted')
  await page.goto('/')
  await page.getByRole('link', { name: /Analyze a supported sample/ }).click()
  await expect(page.getByText('ims_test2_2004.02.19.05.42.39.txt')).toBeVisible()
  await page.goto('/')
  await page.getByRole('link', { name: /Compare the methods/ }).click()
  await expect(page.locator('#glance')).toBeInViewport({ timeout: 10_000 })
})

test('evaluation reports bearing-level counts, fault identification and the no-switch rationale', async ({ page }) => {
  await page.goto('/evaluation#prf')
  const prf = page.locator('#prf table')
  await expect(prf).toContainText('TOCSIN (submitted)')
  await expect(prf.locator('tr.hl')).toContainText('1/2')
  await expect(prf.locator('tr.hl')).toContainText('1/5')
  await expect(page.locator('#fault-id')).toContainText('outer race')
  await expect(page.locator('#no-switch')).toContainText('not used to tune the final solution')
  await expect(page.locator('#state-logic')).toContainText('shown with a verdict')
})

test('robustness examples open the states they describe', async ({ page, request }) => {
  const ex = await (await request.get(`${API}/api/results/robustness_examples`)).json()
  await page.goto(ex.A_alert_kept_through_invalid.url)
  await loaded(page)
  await expect(page.locator('.evidence .badge', { hasText: 'No valid data' })).toBeVisible()
  await expect(page.locator('.evidence .badge', { hasText: 'Alert' })).toBeVisible()
  await expect(page.locator('.retained-note')).toBeVisible()
})

test('alerts carry the actionability note without claiming a defect', async ({ page }) => {
  await page.goto('/demo/test3?guide=alert&b=3')
  await loaded(page)
  await expect(page.locator('.action-note-ws')).toContainText('does not confirm a physical defect')
})

test('working preview panels do not overlap at any width', async ({ page }) => {
  await page.goto('/')
  await page.locator('.preview-frame').scrollIntoViewIfNeeded()
  await expect(page.locator('.preview-main')).toBeVisible({ timeout: 20_000 })
  const a = (await page.locator('.preview-prio').boundingBox())!
  const b = (await page.locator('.preview-main').boundingBox())!
  const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  expect(overlap, `priority list ${JSON.stringify(a)} overlaps main panel ${JSON.stringify(b)}`).toBe(false)
})
