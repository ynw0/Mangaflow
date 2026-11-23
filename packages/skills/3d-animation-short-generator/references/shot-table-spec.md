# Standardized Shot Table Specification

## STEP 5: Standardized Shot Table Video Prompts (Six Columns)

After character cards and scene cards are locked, output standardized video prompts as a shot information table. This step is mandatory and cannot be swapped with storyboard or video generation. Create a canvas table node or markdown table named `标准镜头信息表` or `standard-shot-table`.

The table must have exactly six columns in this order:

| Shot ID & Duration | Continuity Handoff | Reference Anchors (Spatial + Identity) | Hook Type | Shot Description (Timeline) | Audio & Dialogue Track |
|---|---|---|---|---|---|

Column rules:

- **Shot ID & Duration**: shot number plus planned duration, e.g. `S03 / 6s`.
- **Continuity Handoff**: how this shot naturally continues from the previous shot’s ending image, prop position, eyeline, character posture, sound bridge, or emotional state, AND how it sets up the next shot’s opening. This is the cross-shot continuity spine.
- **Reference Anchors (Spatial + Identity)**: four sub-fields, all mandatory.
  - `Fixed Landmarks` — exact named landmarks from the scene card, with their screen-relative positions (e.g. `door-frame: right third`, `kitchen-island: center bottom`).
  - `Character Positions (camera view)` — for every character in the shot, screen-relative position (left/center/right, top/mid/bottom, foreground/midground/background), facing direction, and initial pose.
  - `Exited Character Status` — for any character who was in the previous shot but is not in this shot, state their off-screen position and reason (e.g. `{Character} — exited frame-left, last seen with {approved prop} at {anchor}`).
  - `Lighting Baseline` — inherited key/fill/rim direction from the scene card, plus any per-shot modifier (e.g. `key: warm overhead, fill: cool bounce right, modifier: window-backlit silhouette`).
  - Plus identity bindings: exact approved character card names and exact approved scene card name.
- **Hook Type**: one short label from a controlled vocabulary to describe the shot's existing function rather than force a stunt, e.g. `visual-joke`, `reversal`, `suspense`, `tender`, `chase`, `reveal`, `callback`, `expression-beat`. Used for the per-episode hook distribution self-check.
- **Shot Description (Timeline)**: establish the opening framing, camera, spatial anchors, and prop state. Mark a timed beat where the action, camera, or sound changes. A held pose or continuous action can span several seconds. Use sub-second timing when a sync point or a quick action needs it.
- **Audio & Dialogue Track**: list the shot's sound cues and spoken lines in time order. Fields:
  - `Narration` — voiceover text with time range (omit if no narration).
  - `Dialogue` — line, speaker, tone, time range.
  - `SFX` — keyed sound effects, time-anchored.
  - `Performance Note` — when the protagonist narrates off-screen, mark `narrator-mouth-closed: true`. Record expression or movement where the scene calls for it.

Table-wide rules:

- Each shot must naturally inherit the previous shot’s image state through the `Continuity Handoff` column and set up the next shot in the same column.
- Cover the full shot with consecutive time ranges. Carry forward the opening position, lighting, and room tone until they change. Record the details a storyboard artist needs at each change.
- Performance may use elastic stylized animation when the approved action and tone call for it; do not impose exaggerated squash-and-stretch, fast poses, or comic reactions on every shot. Quiet character moments, restrained faces, and held poses are valid if the story needs them.
- Vary shot sizes when the story changes what the audience needs to see. Repeated framing is valid when it preserves a relationship or makes a later change readable; do not alternate close-up / extreme close-up mechanically.
- Dutch-angle tilted compositions are an option for chase, imbalance, surprise, or slapstick beats when they genuinely clarify the scene, not a compulsory effect.
- Dialogue language only if explicitly requested by the user; otherwise use minimal non-language-specific reactions or mark dialogue as optional / pending confirmation.
- Mark who speaks and when. Sync visible speakers to their lines and keep off-screen narration separate from the on-screen characters’ lip movements.
- A character who left the frame must still be tracked in `Exited Character Status` for at least one shot, then dropped after they are explicitly off-stage for two consecutive shots.

Then show a user choice card:

- Approve table and run self-check (recommended)
- Adjust shot continuity
- Make animation more exaggerated
- Adjust close-up / extreme-close-up rhythm
- Adjust Dutch-angle design

## STEP 5.5: Shot Table Self-Check Gate (Mandatory)

Before moving to pencil storyboards, run a hard self-check on the approved shot table. If any check fails, revise the table and re-run before asking the user to approve storyboarding.

Six required checks:

1. **Hook function and distribution**: every shot retains a `Hook Type` recording its actual narrative purpose. Check that the opening engages, the sequence progresses, and the ending hands off meaningfully; `setup`, `tender`, `expression-beat`, or quiet continuity are valid where appropriate. Flag repeated empty hooks, but do not enforce a reveal/reversal quota or manufacture dramatic first/last shots.
2. **Single-shot duration**: no shot exceeds 15 seconds. If a beat needs more, split it.
3. **Character count per shot**: no shot contains more than three important characters (defined as characters with on-screen action or dialogue).
4. **Spatial anchor inheritance**: for every interior scene with two or more shots, the `Fixed Landmarks` and `Lighting Baseline` of the next shot must either match the previous shot or include an explicit continuity note (e.g. `door-frame moves from right third to center as camera orbits left`).
5. **Timeline coverage**: timed beats cover the shot from `0s` to the end without gaps. Check the order of actions, dialogue and sound cues. A continuous state can stay in one range.
6. **Cross-shot continuity**: reading the `Continuity Handoff` column row by row produces a continuous chain — no shot starts from a state that contradicts the previous shot’s ending. Any shot that flips eyeline, character position, prop state, or lighting must mark the flip explicitly (e.g. `HARD CUT — time skip: 2h`).

If all six pass, place a `shot-table self-check: passed` stamp at the top of the canvas table node and show the user choice card:

- Approve self-check and draw shot storyboards (recommended)
- Show self-check details
- Revise failed checks
- Re-run self-check

If any check fails, do not enter Step 6. Return to Step 5, list the failed rows, and only re-show the storyboard approval card after the table is fixed and the self-check passes.
