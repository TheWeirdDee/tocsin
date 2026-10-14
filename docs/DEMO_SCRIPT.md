# Demo video: storyboard and shot list (about 2 minutes)

Plain narration. No invented customer, incident or inspection outcome. Record the screen at 1440×900 with the browser at 100% zoom, against the local server or the live URL.

| Time | Shot | On screen | Narration |
|---|---|---|---|
| 0:00 | Landing hero | `/` | "TOCSIN tells a maintenance lead which bearing to inspect first, and shows the vibration evidence behind each alert." |
| 0:10 | Scroll to "Today / With TOCSIN" | `/` | "A fixed vibration alarm says something is louder. It doesn't say which part, or why. TOCSIN looks at each bearing's own fault frequencies and compares them with that bearing's own healthy readings." |
| 0:25 | Open demo, Test 2, press Play at 16/s | `/demo/test2` | "This is a replay of a public run-to-failure test from the University of Cincinnati. It is recorded data, not a live feed. Each reading is one second of vibration, taken every ten minutes. First, each bearing learns its own baseline." |
| 0:40 | Switch to Test 3, click "Next TOCSIN alert onset" | `/demo/test3?b=3` | "On Test 3, bearing 3's outer-race band holds above its threshold for three readings in a row. It moves to the top of the list, about 40 hours before the recording ends." |
| 0:55 | Point at the evidence card and spectrum | same | "Every alert says which band, how far above this bearing's own reference, how many readings it has held, and whether the data was complete. The sentence is built from those numbers. No language model writes it." |
| 1:05 | Complication → gaps; seek to a "No valid data" reading | `/demo/test3?cond=gaps` | "When a reading is missing or broken, TOCSIN gives no verdict. It keeps the last valid state and shows how old it is. A dead sensor never produces an all-clear." |
| 1:15 | Evaluation outcome panel and headline table | `/evaluation` | "We froze thresholds on one test and held two out. Our hypothesis was 'earlier and quieter than an RMS alarm'. It didn't hold. TOCSIN caught one of two failures, earliest on that one, with the least alarm time on healthy bearings. It missed the other." |
| 1:35 | Diagnosis section, then `/demo/test2?b=1&t=900` spectrum | `/evaluation#diagnosis` | "Here's why. The real defect tone sits at 231 hertz, just outside the window we computed from nominal speed. We report that rather than tune it away. A fix would need fresh data to prove it." |
| 1:50 | Analyze page with a sample | `/analyze` | "You can also run the frozen pipeline live on a reading. It takes about 90 milliseconds on a laptop." |
| 1:58 | Landing closing section, URL | `/` | "Public data, the full protocol, and every number reproducible. TOCSIN." |

## Captions to keep visible

- "Recorded dataset replay, not a live machine feed" (already on screen in the demo).
- "2 held-out failures · 6 undamaged bearings".

## Capture checklist

1. Start the server and open `/`.
2. Use a screen recorder at 1440×900, 30 fps, with the system cursor visible.
3. Do one take per row above. Narration can be recorded separately.
4. Do not speed up the UI beyond its own playback controls.
