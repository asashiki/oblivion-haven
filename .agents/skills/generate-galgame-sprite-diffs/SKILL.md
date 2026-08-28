---
name: generate-galgame-sprite-diffs
description: "Generate consistency-locked transparent Galgame full-body character sprites plus WebGAL-ready mouth-sync and eye-brow blink differentials through true-alpha image-to-image conversion, opt-in chroma fallback, source-color-locked local compositing, three distinct closed-mouth runtime-normal poses, sparse expressive mothers, and pixel-forced frames and replacement parts. Use for transparent Galgame standing sprites, pose or expression 差分立绘, WebGAL image-sprite lip sync, blinking, transparent-edge cleanup, age/proportion-faithful conversion, or a browser runtime that composes face parts without GIFs."
---

# Generate Galgame Sprite Diffs

Keep four asset roles separate:

- `reference_normal`: plain standard full-body stance that locks identity, apparent age, proportions, costume, palette, and style; never use it as a runtime pose.
- three approved neutral pose bases: closed-mouth runtime `normal` sprites.
- expressive mother frames: emotion-specific resting frames derived from one approved pose.
- runtime eye/mouth frames: full-canvas WebGAL images produced by local forced compositing, never raw model candidates.

## Transparent-background fast path

The current built-in image-generation model can return transparent-background
character art. Treat a real RGBA source as the preferred input, not as a reason
to run chroma removal again:

1. Inspect the PNG mode and alpha extrema. If an alpha channel is present and
   non-empty, preserve it as the authoritative silhouette and skip chroma
   cutout, despill, and matte removal.
2. A checkerboard shown in a preview is not proof of transparency. Reject or
   locally strip any baked checkerboard/solid matte before registration; never
   ship it as alpha.
3. Keep the source canvas, alpha edge, identity, proportions, costume, and
   accessories byte-stable wherever the request does not authorize a change.
4. For a genuinely opaque source, make one fidelity-locked image-to-image edit
   whose only material change is a real transparent alpha background. Validate
   the saved PNG's alpha, full silhouette, pose, expression, costume, palette,
   linework, and skin colors before any eye/mouth work.
5. If the transparent edit still returns an opaque file or a baked
   checkerboard, retry at most the configured limit and then stop. Chroma
   cutout is an explicit compatibility fallback only when the user has allowed
   `allow_chroma_fallback=true`; never silently downgrade to it.

Transparency optimization applies to base and mother-frame generation only. It
does not weaken the runtime rule: eyes and mouths still use fixed-coordinate
plates, reviewed masks, and local forced compositing. Candidate alpha is never
authoritative; the approved mother alpha is copied into every accepted part.

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

python "$SKILL_DIR/scripts/sprite_tools.py" alpha-route \
  <primary-reference> --json <run>/work/qa/input-alpha-route.json

python "$SKILL_DIR/scripts/build_prompts.py" \
  --config <run>/config.json --key-color '#fc5d21' --out <run>
```

`--key-color` now plans only the optional compatibility fallback. It is not the
default generation background.

Resolve `SKILL_DIR` to this `SKILL.md` directory. Built prompts and model/intermediate files belong under `<run>/work`; only engine-ready material belongs under `<run>/deliverables`.

## Stage 1: approve the standard reference

Use the latest built-in image-generation model by default; in Codex follow
`$imagegen`. Request a genuinely transparent background for every new base or
mother frame, then validate the returned file rather than trusting a preview
checkerboard. Never downgrade this workflow to `gpt-image-1.5` or describe
that older model as the required transparency route. Use API mode only when
the user explicitly selects it; the bundled API adapter targets `gpt-image-2`.

If the supplied source is already valid RGBA and already has the approved pose,
use it directly. Otherwise make exactly one edit call with
`work/prompts/reference_normal.txt`; for an opaque reference this is the single
high-fidelity transparent conversion. Save the returned RGBA PNG, validate its
real alpha, compare it to the source on light and dark backgrounds, normalize,
and register:

```bash
python "$SKILL_DIR/scripts/sprite_tools.py" normalize \
  <reference-transparent-rgba> \
  <run>/work/finals/<slug>_reference_normal.png \
  --canvas 1024x1536 --margin-percent 6 \
  --write-transform <run>/work/transforms/reference_normal.json

python "$SKILL_DIR/scripts/run_state.py" <run>/manifest.json base-ready \
  --source <reference-source> \
  --final <run>/work/finals/<slug>_reference_normal.png
```

Validate alpha extrema, complete loading, canvas, margins, transparent corners,
and the full silhouette. Show the transparent result over both light and dark
backgrounds and stop at `BASE_REVIEW`. Any age-up, smaller head, longer legs,
slimmer build, face change, skin/palette shift, missing white clothing, damaged
hair tip, matte halo, or painted checkerboard is rejection. If and only if the
user explicitly enabled chroma fallback, the old `choose-key` and `cutout`
commands remain available under `scripts/sprite_tools.py`.

After approval:

```bash
python "$SKILL_DIR/scripts/run_state.py" <run>/manifest.json approve-base
```

## Stage 2: approve three distinct pose bases

Generate each pose in a separate transparent edit call from the same approved
RGBA `reference_normal`. Never derive one pose from another. Preserve true
alpha, calculate its own normalization transform, validate it, and register it
with `pose-ready`.

For `side`, turn left or right according to silhouette readability or the configured direction. A larger lean is allowed, but retain a recognizable full face and direct eye contact. Reject a fake side pose that changes only hands or hair.

Build a contact sheet containing the standard reference and all poses. Ask about personality fit, distinctness, proportions, hands, costume, and the side pose’s complete body axis. Stop at `POSES_REVIEW`.

```bash
python "$SKILL_DIR/scripts/run_state.py" <run>/manifest.json approve-poses
```

## Stage 3: approve expressive mother frames

For every configured expression:

1. use only its mapped approved transparent pose source;
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

Create one eye-and-brow mask and one mouth mask per `mask_profile`, then reuse
them only after checking the actual mother frame. Do not trust fixed
coordinates, eye color, or a generic face detector. The eye mask has two kinds
of individually shaped solid cores: eye ellipses cover the complete old eye
construction and its clean-skin clearance; optional brow ellipses cover each
eyebrow and the small path through which it may move during the blink. Do not
replace them with one large face rectangle. A larger eye-brow union is correct
only when its overlay avoids unrelated hair, nose, temple, and face outline.
Every iris, sclera edge, upper/lower lash, outer-corner spike, old brow stroke,
and antialiased gray/black pixel that can be displaced must lie inside a
solid-white `255` core, never in the feather shoulder. The script feathers only
outward; do not use a symmetric blur that can mix old black ink back in.

Before creating any mask, crop and inspect the actual approved mother at face
scale and record the eye and mouth centers from that exact file. Never reuse a
rectangle, center, or anchor from another pose, another expression, an earlier
generation candidate, or a visually similar sprite. Treat a part rectangle as
invalid when the mother-frame feature is not visibly centered inside it. For
mouths, the resting mouth ink and the planned largest aperture must both fall
inside the solid core; if the source mouth remains visible outside the mask,
stop and correct coordinates before any generation call. This gate is required
even when every file uses the same 1024x1536 canvas.

```bash
python "$SKILL_DIR/scripts/face_parts.py" mask \
  --base <approved-pose-final> \
  --ellipse <cx,cy,rx,ry> --ellipse <cx,cy,rx,ry> \
  --brow-ellipse <cx,cy,rx,ry> --brow-ellipse <cx,cy,rx,ry> \
  --feather 4 \
  --allow-out <run>/work/masks/<profile>_eyes_allow.png \
  --api-out <run>/work/masks/<profile>_eyes_api.png \
  --overlay-out <run>/work/masks/<profile>_eyes_overlay.png \
  --json <run>/work/qa/<profile>_eyes_mask.json
```

Use one ellipse for the mouth and omit `--brow-ellipse`. API masks have
transparent edit regions; local allow masks use white as the only permitted
region. The overlay renders eye cores red and brow activity cores amber so a
reviewer can reject a brow region that accidentally reaches the hair.

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
  --max-surface-median-delta 10 --max-surface-p95-delta 28 \
  --json <planned-runtime-qa>

python "$SKILL_DIR/scripts/run_state.py" <run>/manifest.json runtime-ready \
  --asset <runtime-id__state> \
  --source <chroma-runtime-source> \
  --candidate <transparent-runtime-candidate> \
  --frame <planned-runtime-frame> \
  --part <planned-local-part> \
  --qa <planned-runtime-qa>
```

Raw candidates never become deliverables. Every accepted frame must report
`outside_mask_changed_pixels: 0`, `alpha_changed_pixels: 0`, and surface-color
metrics below the configured limits. The surface gate measures bright local
skin/flat-color pixels inside the legal mask; it exists because a visibly wrong
skin patch can otherwise be fully legal with respect to mask coordinates.
Before final export, visually compare both mouth states at face scale; if their
amplitude jumps too far, regenerate only the worse mouth state once.

Numerical compose checks are necessary but not sufficient. Build a full-canvas
contact sheet containing the mother, every eye state, and every mouth state for
each expression, plus an 8x face crop. Reject a set when any changed eye or
mouth appears beside the source feature, when both the old and new mouth are
visible, when an eye lands in hair or skin outside the socket, or when a blink
retains iris/sclera fragments. A test that only checks file presence, hashes,
or `outside_mask_changed_pixels` must never be reported as visual success.

For every mouth state, also compare `base / half / open` at 8× nearest-neighbor scale and toggle each generated frame against its mother. Reject any square or soft-focus patch in the nose, upper-left mouth area, cheek, or chin; any doubled resting mouth line; or any skin-texture change outside the lip/inner-mouth antialias ring. `outside_mask_changed_pixels: 0` is not sufficient when the mouth mask itself is oversized. Record a concrete mouth-review note for all 18 states. Verify that `half` and `open` share mouth corners, direction, inner-mouth palette, and emotion, with `open` only one modest aperture step above `half`.

Preserve the approved mother frame's alpha channel byte-for-byte during forced compositing. Built-in candidates may return an opaque black plate even when the corresponding mother pixels are transparent; candidate alpha is never authoritative. Every accepted compose report must record `alpha_changed_pixels: 0` and `base_transparent_became_visible_pixels: 0`. Reject export if either value is nonzero. Inspect each cropped replacement part over both light and dark backgrounds and confirm that pixels outside the mother's visible face/hair silhouette remain fully transparent; a zero-error replay against an already polluted frame is not sufficient evidence.

Before generating any open-eyed mother's runtime eye states, record four immutable mother-frame anchors: inner and outer corner for each visible eye. Use actual anatomical eye corners, not iris centers, face-box edges, or generic detector output. Repeat these anchors numerically in both eye-state prompts. Reject rather than translate, warp, or squeeze a candidate when either eye's new lid endpoint misses its corresponding anchor by more than 2 final-canvas pixels, when the new lid midpoint falls outside the original open-eye aperture, when the two eyes acquire a different spacing/scale relationship, or when the state changes the mother frame's gaze, perspective, or emotional eye-corner direction. A blink state is a change in lid aperture, not a new pair of eyes.

Treat the rendered locator guide as a blocking review gate before any eye-generation call. At face scale, every inner/outer cross must visibly sit on the corresponding anatomical eye-corner pixel of the mother; reject immediately when a cross lands on the iris, sclera, nose skin, hair, temple, or ear. Do not infer approval from plausible numbers or from a previously recorded guide: write the four final-canvas pixel coordinates in the review note and visually re-open the guide whenever the mother or edit-plate mapping changes.

For every `eyes_half` and `eyes_close`, treat registration, old-ink cleanup,
eyebrow continuity, and local-color continuity as separate blocking gates.
`outside_mask_changed_pixels: 0` proves only that the edit did not leak; it
proves neither alignment nor cleanup. Generate a wide 4× nearest-neighbor
review strip that includes the eyebrows and nearby hairline, with the four
mother-frame eye anchors overlaid. Inspect the raw candidate, forced final on
light/dark backgrounds, and the base/final change map:

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

Reject any endpoint jump, vertical eye jump, changed inter-eye spacing,
perspective/scale change, gray or black arc parallel to the new lid, surviving
full-open contour, iris/sclera/lower-lash fragment in `eyes_close`, remote black
block, orphan lash tip, disconnected old eyebrow fragment, or old ink restored
at the mask feather. Toggle the mother and final at 500 ms: eye corners stay
fixed, aperture closes, and eyebrows move subtly as part of the same blink
without changing their emotional direction. Static brows are allowed only when
the source expression truly requires them and the reviewer records why; they
must never be preserved by a blanket rule. Reject any warmer, cooler, grayer,
blurrier, or flatter skin patch inside the eye-brow region even when it passes
the mask boundary check. If the raw candidate is aligned but the forced frame
contains old ink, enlarge or reshape the specific solid eye/brow core into
clean skin and recompose; do not enlarge one rectangle across hair or the face.

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

Keep all prompts, transparent generation sources, optional fallback chroma
sources/cutouts, approved work finals, transforms, masks, raw candidates, and
QA under `work/`. Do not mix them into `deliverables/figures`.

Always include a root-level offline `deliverables/index.html` that can switch every runtime mother, available eye state, and `close / half / open` mouth state and can combine eyes with mouths. It must use the exported part rectangles from the final runtime manifest, clearly lock fixed-closed expressions, require no network or file picker, and remain inside the final ZIP. Do not display this inspector inline in chat unless the user explicitly asks; provide the package link instead.

When updating an existing test page, restore and adapt the established page and
asset contract instead of creating a second route with a second compositor.
Keep only controls needed to verify the requested states. In particular, do not
add engine-mode, WebGAL-launch, or A/B buttons unless the user explicitly asks
for those controls.

`figures/` is the current WebGAL contract. `parts/` and `runtime/` are the lossless browser/custom-engine contract. Each exported part is cropped from the already accepted full frame using its recorded `mask_bbox`; apply it by clearing that exact rectangle and drawing the patch at the recorded coordinate, not by visually guessing an offset or stacking a translucent model candidate. This permits simultaneous eye and mouth states while preserving the original transparent canvas.

Set `make_contact_sheet=false` and `make_demo_gifs=false` by default. Keep eye-review strips and other inspection crops under `work/qa`; never put them in the delivery package or display them inline unless the user explicitly asks to see them. A GIF is optional visual evidence only: it is palette-limited, may have a matte background, and cannot follow actual dialogue duration. The Canvas preview must animate from the base plus exported replacement parts and let the caller choose speaking duration and blinking policy. In the final response, prefer one download link and a concise QA summary; do not spend an extra generation call on a chat-only preview image.

Report the canvas, exact generation-call count, fixed-eye expressions, full-frame/part counts, warnings, and export verification. WebGAL maps base to `mouthClose` and dynamic `eyesOpen`; fixed-closed expressions omit eye parameters entirely.

## Preserve portability

Keep Provider calls outside prompt construction, state transitions, masking, compositing, and export. `scripts/gpt_image2_adapter.py` is optional API mode and accepts `--mask`; Work/Codex stays on built-in image generation by default. Even when the Provider accepts a mask, local forced compositing remains mandatory because model mask adherence is not a pixel-level guarantee.
