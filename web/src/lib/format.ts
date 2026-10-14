const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Recording timestamps are local rig time without zone; parse as naive and never shift. */
export function parseNaive(iso: string): Date {
  const [d, t = '00:00:00'] = iso.split('T')
  const [y, m, day] = d.split('-').map(Number)
  const [hh, mm, ss] = t.split(':').map(Number)
  return new Date(Date.UTC(y, m - 1, day, hh, mm, Math.floor(ss || 0)))
}

const pad = (n: number) => String(n).padStart(2, '0')

export function fmtStamp(iso: string): string {
  const d = parseNaive(iso)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

export function fmtShortDate(iso: string): string {
  const d = parseNaive(iso)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

export function hoursBetween(a: string, b: string): number {
  return (parseNaive(b).getTime() - parseNaive(a).getTime()) / 3_600_000
}

export function fmtDuration(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return '—'
  const h = Math.abs(hours)
  if (h < 1) return `${Math.round(h * 60)} min`
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`
  return `${(h / 24).toFixed(1)} days`
}

export function fmtNum(x: number | null | undefined, nd = 1): string {
  if (x == null || !Number.isFinite(x)) return '—'
  return x.toFixed(nd)
}

export function fmtHz(x: number | null | undefined): string {
  return x == null || !Number.isFinite(x) ? '—' : `${x.toFixed(x < 100 ? 1 : 0)} Hz`
}
