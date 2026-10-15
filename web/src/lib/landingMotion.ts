import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useLayoutEffect, type RefObject } from 'react'

gsap.registerPlugin(ScrollTrigger)

const REVEAL = { opacity: 0, y: 18, duration: 0.6, ease: 'power2.out' }
const ONCE = { start: 'top 88%', once: true }

/** Records how many ScrollTriggers exist, so tests can confirm none are duplicated after navigation. */
function recordTriggers() {
  document.documentElement.dataset.scrollTriggers = String(ScrollTrigger.getAll().length)
}

/**
 * Landing-page motion. Progressive enhancement: every element is visible in the markup and
 * stays visible if this never runs. Tweens are created before the first paint (layout effect),
 * so nothing flashes, and they only change opacity and transform. With reduced motion requested,
 * nothing is animated. Everything is scoped to the page and reverted on unmount, which also kills
 * its ScrollTriggers, so returning to the page never duplicates them.
 */
export function useLandingMotion(root: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    let mm: gsap.MatchMedia | null = null
    let ro: ResizeObserver | null = null
    try {
      mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const q = gsap.utils.selector(el)

        // Hero: a short, deliberate entrance. Whole elements move; text is never split.
        gsap.from(q('.hero-inner > *'), { ...REVEAL, y: 14, duration: 0.7, stagger: 0.08, delay: 0.05, clearProps: 'opacity,transform' })
        gsap.from(q('.preview-frame'), { opacity: 0, y: 28, duration: 0.9, delay: 0.35, ease: 'power3.out', clearProps: 'opacity,transform' })

        // Section headings and the content that belongs with them arrive together.
        q('.sec').forEach((sec) => {
          const head = sec.querySelector('.sec-head, .split > div:not(.panel), .faq-split > div:first-child')
          if (head) gsap.from(head, { ...REVEAL, clearProps: 'opacity,transform', scrollTrigger: { trigger: head, ...ONCE } })
        })
        gsap.from(q('.entry'), { ...REVEAL, stagger: 0.06, clearProps: 'opacity,transform', scrollTrigger: { trigger: q('.entry-grid')[0], ...ONCE } })

        // The three steps and the real reading they describe reveal as pairs, with a connector
        // drawn down the step numbers: quality check, then comparison with the reference, then the verdict.
        const steps = q('.steps > li')
        const pcRows = q('.pipeline-card li')
        const list = q('.steps-split .steps')[0]
        if (steps.length) {
          const tl = gsap.timeline({ scrollTrigger: { trigger: q('.steps-split')[0], start: 'top 80%', once: true } })
          // The connector is the list's ::before line, scaled through --connector (1 without animation).
          if (list) tl.fromTo(list, { '--connector': 0 }, { '--connector': 1, duration: 1.2, ease: 'none' }, 0)
          steps.forEach((s, i) => {
            tl.from(s, { ...REVEAL, clearProps: 'opacity,transform' }, i * 0.4)
            if (pcRows[i]) tl.from(pcRows[i], { opacity: 0, x: 12, duration: 0.5, ease: 'power2.out', clearProps: 'opacity,transform' }, i * 0.4 + 0.1)
          })
        }

        // Evidence panels: the card, then its figures (measurement, reference, persistence) in reading order.
        q('.ev-card, .nodata-card, .sec > .panel, .split > .panel, .closing').forEach((p) => {
          gsap.from(p, { ...REVEAL, y: 22, clearProps: 'opacity,transform', scrollTrigger: { trigger: p, ...ONCE } })
        })
        const stats = q('.ev-stats > div')
        if (stats.length) gsap.from(stats, { opacity: 0, y: 10, duration: 0.5, stagger: 0.12, delay: 0.2, ease: 'power2.out', clearProps: 'opacity,transform', scrollTrigger: { trigger: q('.ev-stats')[0], ...ONCE } })
        const nodata = q('.nodata-list > li')
        if (nodata.length) gsap.from(nodata, { opacity: 0, x: -10, duration: 0.45, stagger: 0.1, ease: 'power2.out', clearProps: 'opacity,transform', scrollTrigger: { trigger: q('.nodata-list')[0], ...ONCE } })

        // Facts and questions: restrained entrances. Results are shown as they are; nothing counts up.
        q('.facts').forEach((f) => gsap.from(f.children, { ...REVEAL, stagger: 0.06, clearProps: 'opacity,transform', scrollTrigger: { trigger: f, ...ONCE } }))
        gsap.from(q('.faq details'), { ...REVEAL, y: 10, stagger: 0.05, clearProps: 'opacity,transform', scrollTrigger: { trigger: q('.faq')[0], ...ONCE } })
      }, el)

      // Data-driven sections change height after loading; keep trigger positions accurate.
      let raf = 0
      ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => ScrollTrigger.refresh()) })
      ro.observe(el)
      recordTriggers()
    } catch {
      // Animation is an enhancement: if it fails, the content is already visible.
      mm?.revert()
      mm = null
    }
    return () => {
      ro?.disconnect()
      mm?.revert()
      recordTriggers()
    }
  }, [root])
}

/**
 * One pass of focus cues over the working preview once its real data has loaded:
 * the top-priority bearing, then its evidence figures, then the score trend. Box-shadow and
 * opacity only; the controls stay usable throughout. Skipped with reduced motion.
 */
export function usePreviewFocus(root: RefObject<HTMLElement | null>, ready: boolean) {
  useLayoutEffect(() => {
    const el = root.current
    if (!el || !ready) return
    let mm: gsap.MatchMedia | null = null
    try {
      mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const q = gsap.utils.selector(el)
        const ring = '0 0 0 2px rgba(255, 117, 31, 0.55)'
        const none = '0 0 0 0px rgba(255, 117, 31, 0)'
        const tl = gsap.timeline({ delay: 0.3, scrollTrigger: { trigger: el, start: 'top 75%', once: true } })
        tl.from(q('.preview-prio li'), { opacity: 0, x: -8, duration: 0.4, stagger: 0.06, ease: 'power2.out', clearProps: 'opacity,transform' })
        for (const sel of ['.preview-prio button.on', '.preview-stats', '.preview-main .chart']) {
          const target = q(sel)[0]
          if (!target) continue
          tl.fromTo(target, { boxShadow: none }, { boxShadow: ring, duration: 0.35, ease: 'power1.out' })
            .to(target, { boxShadow: none, duration: 0.6, ease: 'power1.in', clearProps: 'boxShadow' }, '+=0.35')
        }
      }, el)
      recordTriggers()
    } catch {
      mm?.revert()
      mm = null
    }
    return () => { mm?.revert(); recordTriggers() }
  }, [root, ready])
}
