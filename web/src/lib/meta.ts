// Page titles and descriptions: short, plain and no stronger than the results support.
type Meta = { title: string; description: string }

const SITE: Meta = {
  title: 'TOCSIN · Bearing vibration alerts with evidence',
  description: 'TOCSIN checks bearing vibration, flags unusual changes and shows the evidence behind each alert. A research demo on NASA bearing recordings.',
}

const PAGES: Record<string, Meta> = {
  '/': SITE,
  '/demo': { title: 'Replay · TOCSIN', description: 'Replay real bearing recordings and see each reading, alert and missing-data check.' },
  '/evaluation': { title: 'Results · TOCSIN', description: 'How TOCSIN did on held-out bearing tests, including the failure it missed.' },
  '/analyze': { title: 'Analyze a reading · TOCSIN', description: 'Upload one bearing vibration reading and compare it with a healthy reference.' },
  '/data': { title: 'Data · TOCSIN', description: 'The NASA bearing recordings behind TOCSIN, and what their labels can and cannot tell you.' },
}

export function pageMeta(pathname: string): Meta {
  const key = pathname.startsWith('/demo') ? '/demo' : pathname.replace(/\/+$/, '') || '/'
  return PAGES[key] ?? { title: 'Page not found · TOCSIN', description: SITE.description }
}

export function applyMeta(pathname: string) {
  const m = pageMeta(pathname)
  document.title = m.title
  document.querySelector('meta[name="description"]')?.setAttribute('content', m.description)
}
