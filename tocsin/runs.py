"""IMS run definitions (labels from the official IMS readme)."""
from __future__ import annotations

RUNS = {
    "test1": {
        "archive": "1st_test.rar",
        "label": "IMS Test 1",
        "role": "tuning",
        "channels": {1: 0, 2: 2, 3: 4, 4: 6},  # bearing -> column (first of each x/y pair)
        "faulty": {3: "inner-race defect", 4: "roller-element defect"},
        "expected_family": {3: "BPFI", 4: "2xBSF"},
        "readme": "Inner race defect in bearing 3 and roller element defect in bearing 4 at end of test.",
        "readme_files": 2156,
    },
    "test2": {
        "archive": "2nd_test.rar",
        "label": "IMS Test 2",
        "role": "held-out",
        "channels": {1: 0, 2: 1, 3: 2, 4: 3},
        "faulty": {1: "outer-race failure"},
        "expected_family": {1: "BPFO"},
        "readme": "Outer race failure in bearing 1 at end of test.",
        "readme_files": 984,
    },
    "test3": {
        "archive": "3rd_test.rar",
        "label": "IMS Test 3",
        "role": "held-out",
        "channels": {1: 0, 2: 1, 3: 2, 4: 3},
        "faulty": {3: "outer-race failure"},
        "expected_family": {3: "BPFO"},
        "readme": "Outer race failure in bearing 3 at end of test.",
        "readme_files": 4448,
    },
}

BEARINGS = [1, 2, 3, 4]
