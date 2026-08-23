---
name: generate-galgame-sprite-diffs
description: "Generate consistency-locked Galgame full-body character sprites plus WebGAL-ready mouth-sync and blink differentials through guarded chroma cutout, three distinct closed-mouth runtime-normal poses, sparse expressive mothers, and pixel-forced eye/mouth frames and replacement parts. Use for transparent Galgame standing sprites, pose or expression 差分立绘, WebGAL image-sprite lip sync, blinking, transparent-edge cleanup, age/proportion-faithful conversion, or a browser runtime that composes eye/mouth parts without GIFs."
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

Every pose base keeps both eyes open and the mouth fully closed. Allow a faint friendly closed-lip curve, but no open mouth or emotion-coded smile. At pose review, reject a group if two poses remain interchangeable at contact-sheet size. The hand arrangement, shoulders, torso axis, hips, clothing, feet, and weight must differ coherently; changing only one hand is insufficient.

## Keep the four-stage contract

Use these states:

1. `BASE_PENDING` → generate `reference_normal`.
2. `BASE_REVIEW` → stop for base approval.
3. `POSES_PENDING` → generate all configured poses independently from the approved reference.
4. `POSES_REVIEW` → stop for pose-group approval.
5. `EXPRESSIONS_PENDING` → generate all expressions independently from their mapped approved poses.
6. `EXPRESSIONS_REVIEW` → stop for expression-group approval.
7. `RUNTIME_PENDING` → generate sparse eye/mouth candidates and force-compose them.
8. `COMPLETE` → export WebGAL frames, runtime replacement parts, compositor, previews, README, and inventory.

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

Use the latest built-in `image2` generation model by default; in Codex follow `$imagegen`. Never downgrade this workflow to `gpt-image-1.5` or describe that older model as the required transparency route. Use API mode only when the user explicitly selects it; the bundled API adapter targets `gpt-image-2`.

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
- generate `eyes_half` only when explicitly listed in that mother’s `extra_states`; the optimized default lists it for every open-eyed mother because it doubles as a useful alternate mood frame, although WebGAL does not require it for automatic blinking.

The two mouth states are neighboring movements. `mouth_open` must be only modestly more open than `mouth_half_open`, with the same emotion, mouth corners, inner-mouth palette, and teeth/tongue policy.

### Build and inspect masks

Create one eye mask and one mouth mask per `mask_profile`, then reuse them for expressions mapped to that pose. Do not trust fixed coordinates, eye color, or a generic face detector. Estimate normalized ellipses from the approved pose, render an overlay, inspect it, and adjust until it covers the complete original eye construction plus a clean-skin safety ring without touching unrelated hair, brows, nose, or face outline. Every iris, sclera edge, upper/lower lash, outer-corner spike, and antialiased gray/black eye pixel must lie inside the solid-white `255` core, never in the feather shoulder. The script preserves this core at full replacement strength and feathers only outward; do not replace it with a symmetric blur that can mix old eye ink back into the result.

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

For mouths, make the solid core much tighter than an eye mask: include the complete resting mouth line, the largest planned aperture, and only a 2–3 final-pixel antialias safety ring. The core and feather must not touch the nose mark or extend into broad cheek/chin skin. Treat the rendered mask overlay—not the nominal ellipse radius—as authoritative. A mouth mask whose nonzero shoulder reaches the nose is invalid.

### Generate candidates independently

Never use the full-body canvas as the direct runtime edit target. A same-size model output can still recenter or rescale the whole character, and cropping its eyes at the mother's coordinates produces a visibly misplaced patch. Instead, prepare a fixed-coordinate square edit plate from each approved mother and its eye or mouth mask:

```bash
python "$SKILL_DIR/scripts/face_parts.py" edit-plate \
  --base <approved-mother-final> \
  --mask <profile-region-allow-mask> \
  --context-scale 2.4 --plate-size 1024 \
  --out <run>/work/edit-plates/<runtime-id>_<region>.png \
  --json <run>/work/edit-plates/<runtime-id>_<region>.json
```

The plate contains the exact mother-frame coordinate window plus enough unchanged face context to lock scale, angle, hair, nose, cheeks, and eye spacing. Use that plate—not a full-body rekey and never another runtime candidate—as the sole edit target for every runtime call. Require the model output to remain square and preserve the identical crop semantics. The built-in tool may return a larger square than the requested plate; uniformly resample the complete square to the recorded plate size before restoring it. Reject any aspect-ratio change, recentering, expansion, rotation, translation, or different crop; never auto-register, translate, warp, or squeeze one generated eye independently.

For eye states, turn the same four immutable mother-frame anchors used by `eye-review` into a locator-only second reference:

```bash
python "$SKILL_DIR/scripts/face_parts.py" anchor-guide \
  --plate <runtime-eye-edit-plate> \
  --plate-map <runtime-eye-edit-plate-json> \
  --left-inner <x,y> --left-outer <x,y> \
  --right-inner <x,y> --right-outer <x,y> \
  --out <run>/work/edit-plates/<runtime-id>_eyes_anchor-guide.png \
  --json <run>/work/edit-plates/<runtime-id>_eyes_anchor-guide.json
```

Pass the clean plate as Image 1 and the locator guide as Image 2. State that Image 1 is the sole edit target; red crosses mark outer corners, green crosses mark inner corners, and no guide mark may appear in the output. Use the guide from the first attempt for every side-facing or perspective-asymmetric eye state, not only after a failure. The guide remains internal QA and never enters deliverables.

Generate with the manifest-planned runtime prompt and save the opaque plate candidate. The local compositor restores it through the recorded plate map and then permits only the approved eye or mouth mask to enter the final full canvas. Equal plate size is only a file precondition; it is never evidence that newly drawn eyes are registered to the original sockets. For `eyes_close`, explicitly forbid an eyelid crease, eyelid fold, highlight line, shadow line, or any second pale/dark stroke; require exactly one intentional lid contour per eye.

Force-compose and verify:

```bash
python "$SKILL_DIR/scripts/face_parts.py" compose \
  --base <approved-mother-final> \
  --candidate <runtime-edit-plate-candidate> \
  --plate-map <runtime-edit-plate-json> \
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

For every mouth state, also compare `base / half / open` at 8× nearest-neighbor scale and toggle each generated frame against its mother. Reject any square or soft-focus patch in the nose, upper-left mouth area, cheek, or chin; any doubled resting mouth line; or any skin-texture change outside the lip/inner-mouth antialias ring. `outside_mask_changed_pixels: 0` is not sufficient when the mouth mask itself is oversized. Record a concrete mouth-review note for all 18 states. Verify that `half` and `open` share mouth corners, direction, inner-mouth palette, and emotion, with `open` only one modest aperture step above `half`.

Preserve the approved mother frame's alpha channel byte-for-byte during forced compositing. Built-in candidates may return an opaque black plate even when the corresponding mother pixels are transparent; candidate alpha is never authoritative. Every accepted compose report must record `alpha_changed_pixels: 0` and `base_transparent_became_visible_pixels: 0`. Reject export if either value is nonzero. Inspect each cropped replacement part over both light and dark backgrounds and confirm that pixels outside the mother's visible face/hair silhouette remain fully transparent; a zero-error replay against an already polluted frame is not sufficient evidence.

Before generating any open-eyed mother's runtime eye states, record four immutable mother-frame anchors: inner and outer corner for each visible eye. Use actual anatomical eye corners, not iris centers, face-box edges, or generic detector output. Repeat these anchors numerically in both eye-state prompts. Reject rather than translate, warp, or squeeze a candidate when either eye's new lid endpoint misses its corresponding anchor by more than 2 final-canvas pixels, when the new lid midpoint falls outside the original open-eye aperture, when the two eyes acquire a different spacing/scale relationship, or when the state changes the mother frame's gaze, perspective, or emotional eye-corner direction. A blink state is a change in lid aperture, not a new pair of eyes.

For every `eyes_half` and `eyes_close`, treat registration and old-eye cleanup as separate blocking gates. `outside_mask_changed_pixels: 0` proves only that the edit did not leak; it proves neither alignment nor cleanup. Generate a 4× nearest-neighbor review strip with the four mother-frame anchors overlaid, and inspect both the raw candidate and forced final on light and dark backgrounds:

```bash
python "$SKILL_DIR/scripts/face_parts.py" eye-review \
  --base <approved-mother-final> \
  --candidate <runtime-edit-plate-candidate> \
  --plate-map <runtime-edit-plate-json> \
  --frame <planned-runtime-frame> \
  --mask <profile-eyes-allow-mask> \
  --state <eyes_half-or-eyes_close> \
  --left-inner <x,y> --left-outer <x,y> \
  --right-inner <x,y> --right-outer <x,y> \
  --verdict <pass-or-fail> --reviewer-note <specific-observation> \
  --out <run>/work/qa/<runtime-id>__<state>_eye-review.png \
  --json <run>/work/qa/<runtime-id>__<state>_eye-review.json
```

Reject any endpoint jump, vertical eye jump, changed inter-eye spacing, changed perspective/scale relationship, gray or black arc parallel to the new lid, surviving full-open upper-eye contour, iris/sclera/lower-lash fragment in `eyes_close`, or old ink restored at the mask feather. Toggle the mother and final at a slow 500 ms cadence; the eye corners must stay still while only the aperture closes. If the raw candidate is misregistered or contains the ghost contour, regenerate only that eye state from the mother; never repair eye identity by accepting the drift and cropping it into a part. If the raw candidate is aligned and clean but the forced frame is not, enlarge the solid mask core into clean skin and recompose without another model call. Preserve eyebrows unless the expression itself explicitly changes them.

`eye-review` does not auto-approve. It must record an explicit `pass` or `fail`, the four anchors, candidate/frame hashes, and a concrete observation. Register every eye runtime asset with both its forced-composite QA and its passing eye-review JSON. `runtime-ready` and export must reject eye assets with a missing, failed, stale, or state-mismatched review. Never write labels such as `pass-manual-4x` merely because a review image exists.

## Export and deliver

At `COMPLETE`:

```bash
python "$SKILL_DIR/scripts/export_webgal.py" <run>/manifest.json
```

Deliver:

```text
deliverables/
  index.html   # offline inspector for every mother/eye/mouth combination
  README.md
  webgal-manifest.json
  inventory.json
  figures/      # same-canvas WebGAL-ready full PNG frames
  parts/        # exact cropped eye/mouth replacement rectangles
  runtime/
    runtime-manifest.json
    sprite-compositor.js
    preview.html
  previews/     # optional user-requested previews only
```

Keep all prompts, chroma sources, cutouts, approved work finals, transforms, masks, raw candidates, and QA under `work/`. Do not mix them into `deliverables/figures`. Copy every actually required runtime artifact into `deliverables`: never make the user recover expression or eye/mouth assets from the test project.

Always include a root-level offline `deliverables/index.html` that can switch every runtime mother, available eye state, and `close / half / open` mouth state and can combine eyes with mouths. It must use the exported part rectangles from the final runtime manifest, clearly lock fixed-closed expressions, require no network or file picker, and remain inside the final ZIP. Do not display this inspector inline in chat unless the user explicitly asks; provide the package link instead.

`figures/` is the current WebGAL contract. `parts/` and `runtime/` are the lossless browser/custom-engine contract. Each exported part is cropped from the already accepted full frame using its recorded `mask_bbox`; apply it by clearing that exact rectangle and drawing the patch at the recorded coordinate, not by visually guessing an offset or stacking a translucent model candidate. This permits simultaneous eye and mouth states while preserving the original transparent canvas.

Set `make_contact_sheet=false` and `make_demo_gifs=false` by default. Keep eye-review strips and other inspection crops under `work/qa`; never put them in the delivery package or display them inline unless the user explicitly asks to see them. A GIF is optional visual evidence only: it is palette-limited, may have a matte background, and cannot follow actual dialogue duration. The Canvas preview must animate from the base plus exported replacement parts and let the caller choose speaking duration and blinking policy. In the final response, prefer one download link and a concise QA summary; do not spend an extra generation call on a chat-only preview image.

Report the canvas, exact generation-call count, fixed-eye expressions, full-frame/part counts, warnings, and export verification. WebGAL maps base to `mouthClose` and dynamic `eyesOpen`; fixed-closed expressions omit eye parameters entirely.

## Preserve portability

Keep Provider calls outside prompt construction, state transitions, masking, compositing, and export. `scripts/gpt_image2_adapter.py` is optional API mode and accepts `--mask`; Work/Codex stays on built-in image generation by default. Even when the Provider accepts a mask, local forced compositing remains mandatory because model mask adherence is not a pixel-level guarantee.
