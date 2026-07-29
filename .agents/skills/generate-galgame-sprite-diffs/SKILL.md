---
name: generate-galgame-sprite-diffs
description: "Generate consistency-locked Galgame full-body character sprites plus WebGAL-ready mouth-sync and blink differentials through four guarded stages: one standard model-reference stance, three clearly distinct closed-mouth runtime-normal poses, sparse expressive mother frames, and pixel-forced full-canvas eye/mouth frames. Use for transparent Galgame standing sprites, pose or expression 差分立绘, WebGAL image-sprite lip sync, blinking, age/proportion-faithful character conversion, or reusable remote-API sprite pipelines."
---

# Generate Galgame Sprite Diffs

Keep four asset roles separate:

- `reference_normal`: plain standard full-body stance that locks identity, apparent age, proportions, costume, palette, and style; never use it as a runtime pose.
- three approved neutral pose bases: closed-mouth runtime `normal` sprites.
- expressive mother frames: emotion-specific resting frames derived from one approved pose.
- runtime eye/mouth frames: full-canvas WebGAL images produced by local forced compositing, never raw model candidates.

## Use the lean default set

Default to:

- three neutral runtime poses:
  - `idle`: relaxed asymmetrical conversational pose;
  - `side`: clearly different left- or right-leaning three-quarter pose, body about 25–35 degrees, face about 10–20 degrees, pupils still looking at the viewer;
  - `reserved`: visibly inward pose with both hands gathered and a narrower stance;
- six expressive mothers:
  - `laugh` from `side`, eyes fixed closed;
  - `thinking` from `side`, eyes fixed closed;
  - `angry` from `idle`;
  - `sad` from `reserved`;
  - `surprised` from `side`;
  - `shy` from `reserved`.

The three pose bases already are three `normal` expressions. Do not generate another `normal`. Do not generate an ordinary `smile` by default: normal mouth movement supplies ordinary speaking animation. Add either only when the user explicitly overrides this optimized set.

Every pose base keeps both eyes open, mouth fully closed, and face neutral. At pose review, reject a group if two poses remain interchangeable at contact-sheet size. The hand arrangement, shoulders, torso axis, hips, clothing, feet, and weight must differ coherently; changing only one hand is insufficient.

## Keep the four-stage contract

Use these states:

1. `BASE_PENDING` → generate `reference_normal`.
2. `BASE_REVIEW` → stop for base approval.
3. `POSES_PENDING` → generate all configured poses independently from the approved reference.
4. `POSES_REVIEW` → stop for pose-group approval.
5. `EXPRESSIONS_PENDING` → generate all expressions independently from their mapped approved poses.
6. `EXPRESSIONS_REVIEW` → stop for expression-group approval.
7. `RUNTIME_PENDING` → generate sparse eye/mouth candidates and force-compose them.
8. `COMPLETE` → export WebGAL assets, previews, README, and inventory.

Never cross a review gate without explicit approval. If the user explicitly preauthorizes an unattended run, execute the same gates internally and record hashes at each gate; do not remove the checks.

Rejecting the base resets everything. Rejecting poses preserves the approved base. Rejecting expressions preserves the approved base and poses. Reworking only eye/mouth states preserves all approved mother frames.

## Prepare the run

Require at least one character reference or a written description. Inspect each supplied image once and assign:

- `primary-character`: sole authority for identity, apparent age, face, head/body and leg/torso ratios, build, costume, palette, accessories, and style;
- `supporting-character`: same-character view for hidden details only;
- `detail-style`: line, eye, hair, and shading finish only;
- `pose-only`: pose only.

Primary wins every conflict. Never normalize a youthful, compact, petite, chibi, tall, or mature design toward generic adult anatomy.

Create a dedicated run directory and copy [default-config.json](references/default-config.json). Preserve user invariants verbatim. Read [portable-architecture.md](references/portable-architecture.md) when embedding the workflow elsewhere.

```bash
cp "$SKILL_DIR/references/default-config.json" <run>/config.json

KEY_COLOR="$(python "$SKILL_DIR/scripts/sprite_tools.py" choose-key \
  <primary-reference> --preferred '#fc5d21' --plain \
  --json <run>/work/qa/key-selection.json)"

python "$SKILL_DIR/scripts/build_prompts.py" \
  --config <run>/config.json --key-color "$KEY_COLOR" --out <run>
```

Resolve `SKILL_DIR` to this `SKILL.md` directory. Built prompts and model/intermediate files belong under `<run>/work`; only engine-ready material belongs under `<run>/deliverables`.

## Stage 1: approve the standard reference

Use built-in image generation by default; in Codex follow `$imagegen`. Use API mode only when the user explicitly selects it.

Make exactly one call with `work/prompts/reference_normal.txt`. Save the opaque source to the manifest-planned path. Cut out, normalize, validate, and register:

```bash
python "$SKILL_DIR/scripts/sprite_tools.py" cutout \
  <reference-source> <run>/work/cutouts/<slug>_reference_normal.png \
  --scope all --soft-matte --despill \
  --json <run>/work/qa/reference-cutout.json

python "$SKILL_DIR/scripts/sprite_tools.py" normalize \
  <run>/work/cutouts/<slug>_reference_normal.png \
  <run>/work/finals/<slug>_reference_normal.png \
  --canvas 1024x1536 --margin-percent 6 \
  --write-transform <run>/work/transforms/reference_normal.json

python "$SKILL_DIR/scripts/run_state.py" <run>/manifest.json base-ready \
  --source <reference-source> \
  --final <run>/work/finals/<slug>_reference_normal.png
```

Sample every generated source’s actual border color during cutout; do not assume the requested key was reproduced exactly. Validate alpha, complete loading, canvas, margins, transparent corners, and key residue. Show the transparent result and stop at `BASE_REVIEW`. Any age-up, smaller head, longer legs, slimmer build, or face change is rejection.

After approval:

```bash
python "$SKILL_DIR/scripts/run_state.py" <run>/manifest.json approve-base
```

## Stage 2: approve three distinct pose bases

Generate each pose in a separate edit call from the same approved `reference_normal` chroma source. Never derive one pose from another. Cut out each independently, calculate its own normalization transform, validate it, and register it with `pose-ready`.

For `side`, turn left or right according to silhouette readability or the configured direction. A larger lean is allowed, but retain a recognizable full face and direct eye contact. Reject a fake side pose that changes only hands or hair.

Build a contact sheet containing the standard reference and all poses. Ask about personality fit, distinctness, proportions, hands, costume, and the side pose’s complete body axis. Stop at `POSES_REVIEW`.

```bash
python "$SKILL_DIR/scripts/run_state.py" <run>/manifest.json approve-poses
```

## Stage 3: approve expressive mother frames

For every configured expression:

1. use only its mapped approved pose chroma source;
2. use `work/prompts/expression_<id>.txt`;
3. change only the face and explicitly requested blush or moist highlights;
4. reuse the mapped pose transform;
5. compare outside the configured face region;
6. register with `expression-ready`.

Never derive an expression from another expression. Retry a drift failure once with a shorter face-only prompt; if it still fails, show the best candidate and exact warning.

`laugh` and `thinking` keep closed eyes as part of their mother frame. Every expression uses its resting or lowest-volume mouth shape so nearby speaking variants remain coherent.

After all expressions pass review:

```bash
python "$SKILL_DIR/scripts/run_state.py" <run>/manifest.json approve-expressions
```

## Stage 4: build sparse WebGAL eye/mouth frames

Read [webgal-mouth-sync.md](references/webgal-mouth-sync.md) before this stage.

Generate only states listed in `manifest.runtime_assets`:

- `mouth_half_open` and `mouth_open` for each `mouth_sync=true` mother;
- `eyes_close` only for `blink=dynamic`;
- never generate eye states for fixed-closed `laugh` or `thinking`;
- generate `eyes_half` only when explicitly listed in that mother’s `extra_states`; it is not required by WebGAL.

The two mouth states are neighboring movements. `mouth_open` must be only modestly more open than `mouth_half_open`, with the same emotion, mouth corners, inner-mouth palette, and teeth/tongue policy.

### Build and inspect masks

Create one eye mask and one mouth mask per `mask_profile`, then reuse them for expressions mapped to that pose. Do not trust fixed coordinates, eye color, or a generic face detector. Estimate normalized ellipses from the approved pose, render an overlay, inspect it, and adjust until it covers the feature plus local skin fill without touching unrelated hair, brows, nose, or face outline.

```bash
python "$SKILL_DIR/scripts/face_parts.py" mask \
  --base <approved-pose-final> \
  --ellipse <cx,cy,rx,ry> --ellipse <cx,cy,rx,ry> \
  --feather 4 \
  --allow-out <run>/work/masks/<profile>_eyes_allow.png \
  --api-out <run>/work/masks/<profile>_eyes_api.png \
  --overlay-out <run>/work/masks/<profile>_eyes_overlay.png \
  --json <run>/work/qa/<profile>_eyes_mask.json
```

Use one ellipse for the mouth. API masks have transparent edit regions; local allow masks use white as the only permitted region.

### Generate candidates independently

Rekey each approved transparent mother onto the selected key color at the final full canvas. Use this rekeyed mother—not another eye/mouth candidate—as the sole edit input for every runtime call:

```bash
python "$SKILL_DIR/scripts/sprite_tools.py" rekey \
  <approved-mother-final> <planned-rekeyed-base> \
  --key-color "$KEY_COLOR"
```

Generate with the manifest-planned runtime prompt, save the chroma candidate, and cut it out without re-normalizing. The candidate, approved mother, and mask must already share the exact final canvas.

Force-compose and verify:

```bash
python "$SKILL_DIR/scripts/face_parts.py" compose \
  --base <approved-mother-final> \
  --candidate <transparent-runtime-candidate> \
  --mask <profile-region-allow-mask> \
  --frame <planned-runtime-frame> \
  --part <planned-local-part> \
  --min-inside-changed-pixels <config-value> \
  --json <planned-runtime-qa>

python "$SKILL_DIR/scripts/run_state.py" <run>/manifest.json runtime-ready \
  --asset <runtime-id__state> \
  --source <chroma-runtime-source> \
  --candidate <transparent-runtime-candidate> \
  --frame <planned-runtime-frame> \
  --part <planned-local-part> \
  --qa <planned-runtime-qa>
```

Raw candidates never become deliverables. Every accepted frame must report `outside_mask_changed_pixels: 0`. Before final export, visually compare both mouth states at face scale; if their amplitude jumps too far, regenerate only the worse mouth state once.

## Export and deliver

At `COMPLETE`:

```bash
python "$SKILL_DIR/scripts/export_webgal.py" <run>/manifest.json
```

Deliver:

```text
deliverables/
  README.md
  webgal-manifest.json
  inventory.json
  figures/      # only same-canvas WebGAL-ready full PNG frames
  previews/     # contact sheet and demo GIFs
```

Keep all prompts, chroma sources, cutouts, approved work finals, transforms, masks, local parts, raw candidates, and QA under `work/`. Do not mix them into `deliverables/figures`.

Report the canvas, exact generation-call count, fixed-eye expressions, warnings, and export verification. WebGAL maps base to `mouthClose` and dynamic `eyesOpen`; fixed-closed expressions omit eye parameters entirely.

## Preserve portability

Keep Provider calls outside prompt construction, state transitions, masking, compositing, and export. `scripts/gpt_image2_adapter.py` is optional API mode and accepts `--mask`; Work/Codex stays on built-in image generation by default. Even when the Provider accepts a mask, local forced compositing remains mandatory because model mask adherence is not a pixel-level guarantee.
