# Demo video: 3-minute script and verified links

- **Submission form:** the video requirements (length, platform) are **not public**. Check the Devfolio form before recording.
- **Setup:** record at 1440×900, browser zoom 100%, on the live app.
- **Rules:** do not imply the replay is live ingestion. Do not scroll the landing page for more than about 10 seconds.

| Time | Story beat | On screen (verified link) | Narration (plain language) |
|---|---|---|---|
| 0:00–0:20 | **Problem** | `/` hero | "Bearings usually change how they vibrate before they fail. Smaller operators often record that vibration but have no one to interpret it. TOCSIN is a research prototype that turns those recordings into a ranked list of bearings to check, with the measurements behind each one." |
| 0:20–0:35 | **Solution** | Scroll once to the working preview; drag its slider | "This panel is a real recorded test from a NASA bearing rig, replayed. Nothing here is a live machine. For each bearing, TOCSIN compares the strength of known fault-vibration patterns with that same bearing's early readings." |
| 0:35–1:20 | **Working pipeline: a genuine alert** | `/demo/test3?guide=alert&b=3` | "Here is the first sustained alert, on bearing 3 of Test 3, about 40 hours before the recording ends. The card says which pattern changed: the outer race, the bearing's outer ring. It shows how far that pattern rose above this bearing's own reference, and that it held for three valid readings in a row. The score counts how many normal spreads it moved. It is not a probability. The suggested action is a confirmatory inspection; the alert does not prove a defect." Then click "Analyze a supported sample", press Analyze: "And here the same pipeline runs live on the server, on one uploaded reading, in tens of milliseconds." |
| 1:20–1:50 | **Robustness** | `/demo/test2?guide=gaps&cond=gaps&b=1` | "What happens when data is missing? In this labelled test, some readings lose 40% of their samples. TOCSIN gives no verdict for those readings, keeps the last valid state, and shows how old it is. A gap never turns into a clean bill of health, and it never clears an existing alert." |
| 1:50–2:40 | **Evaluation, honestly** | `/evaluation#glance`, then `/demo/test2?guide=miss&b=1` | "We froze the settings on one test and held two tests out. Of two failures, TOCSIN alerted on one. A simple vibration-level alarm and an isolation forest alerted on both. TOCSIN spent the least time alerting on healthy bearings, but that came with a missed failure. Here is the miss: the real fault tone sits just outside the narrow frequency window TOCSIN watches. A simpler variant did better on these recordings, but we did not switch to it after seeing the results, because then this test would no longer be a fair test." |
| 2:40–3:00 | **Close** | `/` closing panel | "TOCSIN shows a working, explainable pipeline with honest results: one alert with evidence, safe handling of missing data, and a reproducible evaluation. The next step is validating it, and the simpler variant, on new recordings from other machines. The links are in the description." |

## Captions

- "Recorded dataset replay. Not a live machine feed." (already on screen in the demo)
- "2 held-out failures · 6 undamaged bearings" (during the evaluation beat)
