# Data provenance

## IMS Bearing Data Set (used)

| Item | Value |
|---|---|
| Producer | NSF I/UCR Center for Intelligent Maintenance Systems (IMS), University of Cincinnati, with support from Rexnord Corp. |
| Repository | NASA Prognostics Center of Excellence (PCoE) Data Set Repository, entry 4 “Bearings” |
| Source URL | https://phm-datasets.s3.amazonaws.com/NASA/4.+Bearings.zip (linked from https://www.nasa.gov/intelligent-systems-division/discovery-and-systems-health/pcoe/pcoe-data-set-repository/) |
| Retrieved | 14 Oct 2026, 18:05 WAT. `Last-Modified: Sun, 18 Sep 2022` |
| Citation | J. Lee, H. Qiu, G. Yu, J. Lin and Rexnord Technical Services (2007). “Bearing Data Set”, IMS, University of Cincinnati. NASA Prognostics Data Repository, NASA Ames Research Center, Moffett Field, CA |
| Licence / terms | No dataset-specific licence is published. The repository terms say the data is used at the user's own risk and ask for acknowledgement of the repository and the donors. TOCSIN redistributes only two individual readings (the Analyze samples) and derived features |
| Procedure | `python scripts/fetch_data.py` downloads the archive, verifies SHA-256, unpacks the inner 7z to the three RARs plus the readme, and verifies those too |

### Checksums (SHA-256)

| File | SHA-256 |
|---|---|
| `4. Bearings.zip` (1,075,597,174 bytes) | `21001ac266c465f5d345ec42d7b508c6a6328487fd9d4d7774422dd5ea10ad83` |
| `IMS.7z` | `c6925060e702708afc47261d349339d7cd97a98166161da6b29c377eb3e66f2c` |
| `1st_test.rar` | `c25241571583948462a3916d97dc11c984a839f38a0da0907fff18c958c0a484` |
| `2nd_test.rar` | `b154d5ba1ae5f7f01cdd4f1bde5b08cfdc2f3134d51ad2f6614b1270a86ab632` |
| `3rd_test.rar` | `01e9ec83c6c55adc0300a20003a261f9a2ac2b714aae4984050325e589252bc8` |
| `Readme Document for IMS Bearing Data.pdf` | `cf46d37c21f7f292c11bbbdd4695d876c417ed1d6425e3d87c962ae2182ae6ed` |

Every individual reading is hashed while it is streamed. `results/manifest.json` records a digest of each run's ordered file-hash list.

### Facts from the official readme (verified)

- Four Rexnord ZA-2115 double-row bearings on one shaft. Speed held constant at 2000 RPM by an AC motor coupled via rub belts. Radial load of 6000 lb applied by a spring mechanism. Force lubrication.
- PCB 353B33 ICP accelerometers. Test 1 has x and y per bearing (8 channels); Tests 2 and 3 have one per bearing (4 channels).
- Each file is a 1-second snapshot of 20,480 points at a 20 kHz sampling rate. The file name is the timestamp. Larger gaps mark the experiment resuming the next working day.
- Test 1: 22 Oct–25 Nov 2003, 2,156 files, every 10 min (first 43 every 5 min). Inner-race defect in B3 and roller-element defect in B4 at the end.
- Test 2: 12–19 Feb 2004, 984 files. Outer-race failure in B1 at the end.
- Test 3: readme says 4 Mar–4 Apr 2004 and 4,448 files. Outer-race failure in B3 at the end.
- Units are **not documented**. Values are treated as raw sensor output.

### Verified against the archive (differences from the readme)

| Run | Files in archive | First | Last | Parse errors |
|---|---|---|---|---|
| Test 1 | 2,156 (readme 2,156) | 2003-10-22 12:06:24 | 2003-11-25 23:39:56 | 0 |
| Test 2 | 984 (readme 984) | 2004-02-12 10:32:39 | 2004-02-19 06:22:39 | 0 |
| Test 3 | **6,324 (readme 4,448)** | 2004-03-04 09:27:46 | **2004-04-18 02:32:55** (readme 4 Apr) | see `results/manifest.json` |

- Test 3 members are stored under `4th_test/txt/` inside `3rd_test.rar`.
- All archived files are used, and the endpoint is the last archived file.

### Bearing geometry (not in the readme)

- Source: Qiu, Lee & Lin (2006), *J. Sound Vib.* 289:1066–1090, as reproduced in later studies of this dataset.
- Values: 16 rollers per row, pitch diameter 2.815 in, roller diameter 0.331 in, contact angle 15.17°.
- Computed defect frequencies at 2000 RPM:
  - BPFO 236.40 Hz
  - BPFI 296.93 Hz
  - BSF 139.92 Hz (2×BSF 279.83 Hz)
  - FTF 14.78 Hz
- These match the published 236.4 / 296.9 Hz. Some tables quote 2×BSF as 278 Hz, which is a rounding or formula-variant difference.

### How labels were established

- The labels come from the IMS readme ("at the end of the test-to-failure experiment, … defect occurred in bearing …"), which reflects post-test inspection by the data producers.
- No onset time is given.

## CWRU Bearing Data Center (not used)

This dataset was considered for fault-type classification at a held-out motor load. It was not used, for two reasons:

- The PS01 rubric can be met by detection alone.
- Disk and time limits on the build machine were tight.

It remains an optional extension.

## Organizer data

- The PS01 text says organizers "should provide" labelled sensor data.
- The published problem-statement document contains no dataset link or file, and none was found on the Devfolio event pages.
- If organizer data is published, it should be used as the primary evaluation. This dependency is open (see `DECISIONS.md`).

## Synthetic data

- Synthetic signals are used **only** in unit tests (impulse trains at known defect frequencies) and in the frontend logic tests.
- Robustness conditions modify real recordings with seeded noise and missing samples. They are always labelled as such.
