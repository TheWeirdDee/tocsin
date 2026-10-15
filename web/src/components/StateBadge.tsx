import { StateGlyph } from './Icons'
import type { StateName } from '../lib/types'
import { STATE_HELP, STATE_LABEL } from '../lib/state'

export function StateBadge({ state, compact = false }: { state: StateName; compact?: boolean }) {
  return (
    <span className={`badge s-${state}`} title={STATE_HELP[state]}>
      <StateGlyph state={state} />
      {compact && state === 'BASELINING' ? 'Baseline' : STATE_LABEL[state]}
    </span>
  )
}
