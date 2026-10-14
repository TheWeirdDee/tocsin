"""Rolling-element bearing kinematics.

Defect frequencies are computed from geometry, never hand-typed. Values are
expressed as orders (multiples of shaft speed) so they can be scaled by a
measured or assumed speed per snapshot.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, asdict


@dataclass(frozen=True)
class BearingGeometry:
    name: str
    n_rollers: int
    pitch_diameter: float  # same unit as roller_diameter
    roller_diameter: float
    contact_angle_deg: float
    source: str

    def orders(self) -> dict[str, float]:
        """Defect frequencies as multiples of shaft rotation frequency."""
        r = (self.roller_diameter / self.pitch_diameter) * math.cos(math.radians(self.contact_angle_deg))
        n = self.n_rollers
        bpfo = n / 2.0 * (1.0 - r)
        bpfi = n / 2.0 * (1.0 + r)
        bsf = self.pitch_diameter / (2.0 * self.roller_diameter) * (1.0 - r * r)
        ftf = 0.5 * (1.0 - r)
        return {"BPFO": bpfo, "BPFI": bpfi, "BSF": bsf, "2xBSF": 2.0 * bsf, "FTF": ftf}

    def frequencies(self, rpm: float) -> dict[str, float]:
        fr = rpm / 60.0
        out = {k: v * fr for k, v in self.orders().items()}
        out["shaft"] = fr
        return out

    def to_dict(self) -> dict:
        return asdict(self)


# Rexnord ZA-2115 as used on the IMS rig. Geometry from Qiu, Lee, Lin (2006),
# J. Sound Vib. 289:1066-1090, as reproduced in later studies of this dataset.
IMS_ZA2115 = BearingGeometry(
    name="Rexnord ZA-2115 (IMS rig)",
    n_rollers=16,
    pitch_diameter=2.815,
    roller_diameter=0.331,
    contact_angle_deg=15.17,
    source="Qiu, Lee & Lin (2006), J. Sound Vib. 289:1066-1090",
)

IMS_NOMINAL_RPM = 2000.0

# Fault families used by the detector, with plain-language names for alert text.
FAULT_FAMILIES = {
    "BPFO": "outer-race",
    "BPFI": "inner-race",
    "2xBSF": "rolling-element",
}
