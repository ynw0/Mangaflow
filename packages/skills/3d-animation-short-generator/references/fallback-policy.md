# Generation Failure and Drift Fallback Policy

### Failure fallback per video model

After the initial H3 render fails or drifts, use this escalation order:

1. **First retry (H3):** regenerate the same clip with the H3 prompt strengthened by quoting the exact `Reference Anchors` block from the table.
2. **Second retry (H3):** if the shot exceeds 6s, split it into shots of ≤6s and preserve the total timeline by distributing the remaining action across adjacent rows in Step 5; rerun the Step 5.5 self-check before rendering the affected clips. If the shot is already ≤6s, keep its duration and simplify action density or prop interaction instead of shortening it again.
3. **Model-switch gate:** if the second H3 retry also fails, switch that shot to Seedance 2.0 only if per-shot mixed mode is already approved. Mark the row `video_model: Seedance2` and continue with the Seedance ladder below. If mixed mode is not approved, pause and ask the user whether to enable per-shot mixed mode and switch this shot, loosen the request, skip the shot with a `placeholder: missing clip` note, or manually supply a reference video. Do not silently change a confirmed global model choice.

Seedance 2.0 fallback ladder (used when the user selects Seedance globally or approves switching the failing shot to Seedance):

After the initial Seedance render fails or drifts, apply up to three escalating retries in order:

1. **First retry:** regenerate with a strengthened prompt that quotes the exact `Reference Anchors` block.
2. **Second retry:** drop reference images and use text-only generation.
3. **Third retry:** if the shot exceeds 6s, split it into shots of ≤6s and preserve the total timeline by distributing the remaining action across adjacent rows; rerun the Step 5.5 self-check before rendering the affected clips. If the shot is already ≤6s, keep its duration and simplify action density or camera complexity instead.
4. **If the third retry also fails,** ask the user whether to switch this shot back to H3 (if mixed mode is not yet approved, first ask permission to enable it), loosen the request, skip the shot with a `placeholder: missing clip` note, or supply a reference video.

### After all clips are rendered

Place the rendered clips on canvas in shot order, group them as `<title> shot clips` (no longer hard-coded to a single model name), and show a user choice card:

- Approve clips and composite full film (recommended)
- Re-render selected clip (with the same or a different video model)
- Fix character mismatch
- Fix scene mismatch
- Strengthen storyboard cleanup
- Fix spatial anchor drift across clips

If a rendered clip drifts from the approved `Reference Anchors` (e.g. door-frame lands on the wrong side, character exits from the wrong edge, lighting flipped), re-render with a strengthened prompt that quotes the exact `Reference Anchors` block from the table. If the drift persists, switch that one shot to the other video model in the mixed-mode path; do not silently mix corrected and uncorrected clips into assembly.

## Storyboard Visualization Fallback

Pencil-storyboard image failures are governed by the single escalation ladder in [storyboard-guidelines.md](storyboard-guidelines.md#storyboard-generation-failure-fallback-visualization-mode-only). Keep this file focused on video-model retries, clip failures, and reference-anchor drift. Text storyboards use the default path in `storyboard-guidelines.md`; do not apply the image fallback to them.

