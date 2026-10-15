import { expect, test, type Page } from '@playwright/test'

// Landing-page motion (GSAP): progressive enhancement, reduced motion, cleanup and usability.

async function scrollToEnd(page: Page) {
  // the page grows as data-driven sections load, so the end is re-measured on every step
  for (let y = 0; y <= (await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)) + 400; y += 400) {
    await page.evaluate((yy) => window.scrollTo({ top: yy }), y)
    await page.waitForTimeout(250)
  }
  await page.waitForTimeout(1200)
}

const notFullyVisible = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll('.landing .hero *, .landing .sec *')]
    .filter((e) => !(e instanceof SVGElement) && getComputedStyle(e).opacity !== '1' && e.getBoundingClientRect().height > 0)
    .map((e) => `${e.tagName}.${e.className}`))

test('reduced motion: landing content is fully visible at once and nothing is animated', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('.landing h1')).toBeVisible()
  await page.waitForTimeout(300)
  expect(await notFullyVisible(page)).toEqual([])
  expect(await page.evaluate(() => document.documentElement.dataset.scrollTriggers)).toBe('0')
})

test('motion: after scrolling through, every landing element is fully visible', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('/')
  await scrollToEnd(page)
  expect(await notFullyVisible(page)).toEqual([])
  expect(errors).toEqual([])
})

test('motion: returning to the landing page never duplicates scroll animations', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(1500)
  const first = Number(await page.evaluate(() => document.documentElement.dataset.scrollTriggers))
  expect(first).toBeGreaterThan(0)
  const counts: number[] = []
  for (let i = 0; i < 3; i++) {
    // in-app navigation, as a visitor does it: the landing page unmounts and must clean up
    await page.locator('.announce').click()
    await expect(page).toHaveURL(/\/evaluation$/)
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.scrollTriggers)).toBe('0')
    await page.goBack()
    await expect(page.locator('.landing h1')).toBeVisible()
    await page.waitForTimeout(1500)
    counts.push(Number(await page.evaluate(() => document.documentElement.dataset.scrollTriggers)))
  }
  // Duplication would double the set or grow it on every return. The total may differ by a couple
  // between visits, because figures that arrive with data get their own trigger only once present.
  expect(Math.max(...counts)).toBeLessThan(first * 2)
  expect(counts[2]).toBeLessThanOrEqual(counts[0])
})

test('motion: calls to action work while the hero is still entering', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: /Explore the replay/ }).first().click()
  await expect(page).toHaveURL(/\/demo\/test3/)
})

test('motion: the preview stays operable during its focus cues', async ({ page }) => {
  await page.goto('/')
  const slider = page.getByRole('slider', { name: /Move through the last four days/ })
  await expect(slider).toBeVisible({ timeout: 20_000 })
  const before = await slider.inputValue()
  await slider.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(slider).not.toHaveValue(before)
  await expect(slider).toBeFocused()
})
