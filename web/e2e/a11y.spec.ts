import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

// Automated WCAG 2.1 A/AA checks (axe-core). Useful regression signal, not an accessibility certification.
const PAGES = ['/', '/demo/test3?guide=alert&b=3', '/demo/test2?cond=gaps&b=1&t=101', '/evaluation', '/data', '/analyze']

for (const path of PAGES) {
  test(`axe: no WCAG A/AA violations on ${path}`, async ({ page }) => {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    const summary = res.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) e.g. ${v.nodes[0]?.target.join(' ')}`)
    expect(summary, summary.join('\n')).toEqual([])
  })
}

test('reduced motion: no running animations when the user prefers reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/demo/test2?t=0')
  const longest = await page.evaluate(() =>
    Math.max(0, ...document.getAnimations().map((a) => Number((a.effect?.getComputedTiming().duration as number) || 0))))
  expect(longest).toBeLessThan(5)
})
