"""Alert state machine with persistence gate and honest missing-data handling.

States
------
BASELINING         reference window still filling; no alert possible
NORMAL             valid reading below threshold (and no active alert)
WATCH              score >= threshold but fewer than k consecutive readings
ALERT              >= k consecutive valid readings at/above threshold; stays
                   until k consecutive valid readings fall below threshold
DATA_INSUFFICIENT  this reading failed validation (or never arrived): counters
                   are frozen, no healthy verdict is issued, and the last valid
                   state is carried with its age
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

BASELINING, NORMAL, WATCH, ALERT, DATA_INSUFFICIENT = 0, 1, 2, 3, 4
STATE_NAMES = ["BASELINING", "NORMAL", "WATCH", "ALERT", "DATA_INSUFFICIENT"]


@dataclass
class StateTrace:
    state: np.ndarray  # displayed state per snapshot
    effective: np.ndarray  # last valid state (what an operator should act on)
    counter: np.ndarray  # consecutive exceedances at this snapshot
    clear_counter: np.ndarray  # consecutive below-threshold readings while in ALERT
    last_valid_idx: np.ndarray  # index of last valid snapshot (-1 if none)


def run_states(score: np.ndarray, valid: np.ndarray, theta: float, k: int, n_ref: int) -> StateTrace:
    """Causal state sequence. Only past and current values are read at each step."""
    n = score.size
    state = np.zeros(n, dtype=np.int8)
    effective = np.zeros(n, dtype=np.int8)
    counter = np.zeros(n, dtype=np.int16)
    clear = np.zeros(n, dtype=np.int16)
    last_valid = np.full(n, -1, dtype=np.int32)

    seen_valid = 0
    cur = BASELINING
    c = 0
    cc = 0
    lv = -1
    for t in range(n):
        if not valid[t]:
            state[t] = DATA_INSUFFICIENT
            effective[t] = cur
            counter[t] = c
            clear[t] = cc
            last_valid[t] = lv
            continue
        lv = t
        seen_valid += 1
        s = score[t]
        if seen_valid <= n_ref or not np.isfinite(s):
            cur = BASELINING
            c = 0
            cc = 0
        else:
            above = s >= theta
            if cur == ALERT:
                if above:
                    c += 1
                    cc = 0
                else:
                    cc += 1
                    c = 0
                    if cc >= k:
                        cur = NORMAL
                        cc = 0
            else:
                if above:
                    c += 1
                    cur = ALERT if c >= k else WATCH
                else:
                    c = 0
                    cur = NORMAL
                cc = 0
        state[t] = cur
        effective[t] = cur
        counter[t] = c
        clear[t] = cc
        last_valid[t] = lv
    return StateTrace(state, effective, counter, clear, last_valid)


def alert_episodes(effective: np.ndarray, valid: np.ndarray) -> list[tuple[int, int]]:
    """(start, end_inclusive) index pairs of contiguous ALERT in the effective state."""
    a = effective == ALERT
    episodes = []
    t = 0
    n = a.size
    while t < n:
        if a[t]:
            s = t
            while t + 1 < n and a[t + 1]:
                t += 1
            episodes.append((s, t))
        t += 1
    return episodes
