import { StateGlyph } from './Icons'
import type { StateName } from '../lib/types'

export const STATE_LABEL: Record<StateName, string> = {
  ALERT: 'Alert',
  WATCH: 'Watch',
  NORMAL: 'Normal',
  BASELINING: 'Learning baseline',
  DATA_INSUFFICIENT: 'No valid data',
}

export const STATE_HELP: Record<StateName, string> = {
  ALERT: 'A defect band has stayed at or above its threshold for the required number of consecutive readings.',
  WATCH: 'A defect band crossed its threshold, but not yet for enough consecutive readings to alert.',
  NORMAL: 'No defect band is above its threshold.',
  BASELINING: "The bearing's own healthy reference is still being learned from its first readings. No alerts are possible yet.",
  DATA_INSUFFICIENT: 'This reading failed validation or never arrived. No verdict is issued and the previous state is kept.',
}

export function StateBadge({ state, compact = false }: { state: StateName; compact?: boolean }) {
  return (
    <span className={`badge s-${state}`} title={STATE_HELP[state]}>
      <StateGlyph state={state} />
      {compact && state === 'BASELINING' ? 'Baseline' : STATE_LABEL[state]}
    </span>
  )
}
