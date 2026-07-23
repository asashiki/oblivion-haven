---
name: generate-galgame-sprite-diffs
description: "Generate consistency-locked Galgame full-body character sprites through a three-stage approval flow: one standard model-reference stance, four character-aware neutral pose bases including one controlled three-quarter engaged pose, and seven basic runtime expressions mapped sparsely across those poses. Use for transparent Galgame standing sprites, pose and expression differentials or 差分立绘, age/proportion-faithful character conversion, and reusable sprite-generation workflows in ChatGPT Work or Codex."
---

# Generate Galgame Sprite Diffs

Keep two different goals separate:

- `reference_normal` is a calm, plain, standard full-body stance used to lock identity, apparent age, proportions, costume, palette, and drawing style.
- approved neutral pose bases provide natural acting for runtime sprites.

Never delete or replace the standard reference merely because a more expressive idle pose is desirable. Generate every pose independently from the approved standard reference, then generate each facial expression independently from its assigned approved pose.

## Keep the three-stage contract

Use these states:

1. `BASE_PENDING`: collect inputs and generate only `reference_normal`.
2. `BASE_REVIEW`: show the transparent standard reference and stop.
3. `POSES_PENDING`: enter only after explicit base approval; generate configured neutral pose bases.
4. `POSES_REVIEW`: show the neutral pose group and stop.
5. `EXPRESSIONS_PENDING`: enter only after explicit pose-group approval; generate configured facial expressions.
6. `COMPLETE`: deliver the standard reference, neutral pose bases, runtime expressions, previews, and manifest.

Never generate poses before base approval. Never generate non-`normal` expressions before pose approval. If the user rejects the base, reset every later stage. If the user rejects only poses, keep the approved base but reset all poses and expressions.

## Prepare the run

Require at least one character reference image or a character-description prompt. Inspect each supplied reference once and assign a role:

- `primary-character`: highest authority for identity, apparent age, face geometry, head-to-body ratio, leg-to-torso ratio, build, costume, palette, accessories, and art style;
- `supporting-character`: another view of the same character used only to recover hidden details;
- `detail-style`: linework, eye/hair detail, and shading finish only; never face shape, age, anatomy, expression, blush, lighting, crop, or pose;
- `pose-only`: pose only, never identity or anatomy.

When references disagree, the primary image wins. A more detailed secondary face image may improve finish but must never mature, slim, lengthen, or redesign the primary character.

Treat the standard model-reference stance as a pose and framing conversion only. Never normalize anatomy toward realistic, adult, fashion-model, taller, slimmer, smaller-headed, or longer-legged proportions. Never age the character up. If cropped or occluded anatomy is ambiguous, choose the compact interpretation most consistent with the primary reference.

Create a dedicated run directory. Start from [default-config.json](references/default-config.json), change only user-supplied or clearly inferable values, and preserve user-listed invariants verbatim.

```bash
cp "$SKILL_DIR/references/default-config.json" <run>/config.json
```

Resolve `SKILL_DIR` to the directory containing this `SKILL.md`. Use it for every bundled script or reference.

Default to:

- portrait `1024x1536`, high quality, bottom-center anchoring, 6% safe margin;
- one plain standard reference stance;
- four low-intensity neutral pose bases:
  - `idle`: character-specific natural conversational idle;
  - `engaged`: controlled three-quarter responding pose with a coherent body-axis and weight shift;
  - `firm`: restrained serious or determined stance;
  - `reserved`: inward, shy, or vulnerable body state;
- seven runtime expressions:
  - `normal` from `idle`;
  - `smile` from `idle`;
  - `laugh` from `engaged`;
  - `angry` from `firm`;
  - `sad` from `reserved`;
  - `surprised` from `engaged`;
  - `shy` from `reserved`.

This produces eleven distinct images by default: one standard reference, four neutral poses, and six additional expression edits. `normal` is the approved `idle` pose itself and requires no extra image-generation call.

## Design character-aware poses conservatively

Populate `pose_design` using this authority order:

1. explicit user personality or gesture instructions;
2. a suitable low-intensity gesture visible in the primary reference;
3. other reliable references explicitly supplied for the same character;
4. conservative low-amplitude defaults.

Never infer a bold personality merely from appearance. Keep `gesture_amplitude` at `low` unless the user or a reliable reference supports stronger acting. Record a suitable original hand gesture as `signature_gesture`; do not preserve an incidental action that is unsafe, prop-dependent, or unusable for conversation.

Pose IDs describe reusable body states, not emotions. Do not rigidly encode “angry pose” or “shy pose” into the pose base. All pose bases keep both eyes open, mouth closed, and a calm neutral face.

Use `engaged` as the one default pose that clearly changes the body axis:

- turn the torso and hips about 15–25 degrees to either side;
- keep the face only about 8–12 degrees away from frontal or lightly returned toward the viewer, with both eyes and the recognizable full face readable;
- use a modest offset stance or weight shift plus one conversational hand gesture;
- make the shoulders, torso, hips, skirt or coat, feet, and balance agree with the same turn; changing only the hands is not a successful three-quarter pose;
- keep `idle`, `firm`, and `reserved` frontal or near-frontal unless stronger evidence supports another choice.

Mirror the turn direction when it better preserves a signature gesture, costume detail, or readable silhouette. If the character design cannot safely support 15–25 degrees, reduce the turn rather than distorting the face or anatomy.

Avoid turns beyond about 30 degrees, side profiles, jumping, arms spread wide, pointing at the viewer, or other strong gestures by default. Treat those as optional `special_pose` requests requiring explicit user intent or a pose reference.

Choose a chroma key before writing prompts. Treat script scoring as a proposal:

```bash
KEY_COLOR="$(python "$SKILL_DIR/scripts/sprite_tools.py" choose-key \
  <character-reference> --preferred '#fc5d21' --plain \
  --json <run>/qa/key-selection.json)"
```

Visually veto any color colliding with hair, eyes, skin accents, clothes, accessories, effects, or antialiased edges. Record the reason for overrides. Build deterministic prompts and the initial manifest:

```bash
python "$SKILL_DIR/scripts/build_prompts.py" \
  --config <run>/config.json \
  --key-color "$KEY_COLOR" \
  --out <run>
```

## Stage 1: generate and review the standard reference

Use built-in image generation by default. In Codex, follow the built-in `$imagegen` skill. Use API mode only when the user explicitly chooses it.

Issue exactly one generation call using `<run>/prompts/reference_normal.txt`. Pass role-labeled character references in the same order as the config. Require one complete character, crown-to-shoes visibility, both hands visible, a calm closed-mouth neutral face, generous padding, no incidental props, and a perfectly flat key-color background.

Save the opaque source as:

```text
<run>/source/<slug>_reference_normal_key.png
```

Cut out, normalize, validate, and register:

```bash
python "$SKILL_DIR/scripts/sprite_tools.py" cutout \
  <run>/source/<slug>_reference_normal_key.png \
  <run>/working/<slug>_reference_normal_cutout.png \
  --scope all --soft-matte --despill \
  --json <run>/qa/reference-normal-cutout.json

python "$SKILL_DIR/scripts/sprite_tools.py" normalize \
  <run>/working/<slug>_reference_normal_cutout.png \
  <run>/<slug>_reference_normal.png \
  --canvas 1024x1536 --margin-percent 6 \
  --write-transform <run>/reference-transform.json

python "$SKILL_DIR/scripts/sprite_tools.py" validate \
  <run>/<slug>_reference_normal.png --expect-size 1024x1536 \
  --key-color "<observed-key>" --json <run>/qa/reference-normal.json

python "$SKILL_DIR/scripts/run_state.py" <run>/manifest.json base-ready \
  --source <run>/source/<slug>_reference_normal_key.png \
  --final <run>/<slug>_reference_normal.png
```

Sample each generated source's actual border color during cutout; never assume the requested prompt color is exact. Validate the transparent output against its own observed color. Use `--scope all` so enclosed background holes also become transparent.

Default to local pixel QA only after generation. Do not reopen the result for a separate visual-model review unless local QA fails or the user asks. Show the transparent reference and ask the user to check likeness, apparent age, face shape, head-to-body ratio, leg length, costume, and drawing style. Any report of aging, height increase, smaller head, or longer legs is a base rejection. Stop at `BASE_REVIEW`.

## Stage 2: generate and review neutral pose bases

After explicit base approval, lock the exact previewed hashes:

```bash
python "$SKILL_DIR/scripts/run_state.py" <run>/manifest.json approve-base
```

Generate every configured pose with one separate edit call:

1. use `<run>/source/<slug>_reference_normal_key.png` as the sole edit target;
2. use `<run>/prompts/pose_<pose>.txt`;
3. change only body pose, hands, the configured body/face angle, weight shift, and unavoidable hair/clothing overlap;
4. keep face neutral, apparent age, stylized proportions, costume, palette, art style, character scale, and flat key background;
5. never derive one pose from another pose.

Use these default filenames:

```text
source/<slug>_normal_key.png          -> <slug>_normal.png
source/<slug>_engaged_normal_key.png  -> <slug>_engaged_normal.png
source/<slug>_firm_normal_key.png     -> <slug>_firm_normal.png
source/<slug>_reserved_normal_key.png -> <slug>_reserved_normal.png
```

Cut out each pose independently. Normalize each with its own transform because its silhouette legitimately changes:

```bash
python "$SKILL_DIR/scripts/sprite_tools.py" normalize \
  <pose-cutout> <pose-final> \
  --canvas 1024x1536 --margin-percent 6 \
  --write-transform <run>/pose-transforms/<pose>.json

python "$SKILL_DIR/scripts/run_state.py" <run>/manifest.json pose-ready \
  --pose <pose> --source <pose-source> --final <pose-final>
```

Require local alpha, canvas, key-residue, safe-margin, and completeness checks. Do not use expression-style outside-face drift thresholds for poses because silhouette changes are intentional. Make a contact sheet containing the standard reference and all neutral poses.

Show the pose group at `POSES_REVIEW`. Ask the user to check personality fit, action intensity, preserved proportions, hands, costume, and whether any pose feels generic or out of character. Confirm that `engaged` changes the complete body axis coherently without becoming a side profile or changing the face identity. Do not generate expressions yet.

## Stage 3: generate expressions from approved poses

After explicit pose-group approval:

```bash
python "$SKILL_DIR/scripts/run_state.py" <run>/manifest.json approve-poses
```

For every configured non-`normal` expression:

1. use only its mapped approved neutral pose source as the edit target;
2. use `<run>/prompts/expression_<expression>.txt`;
3. change only facial expression and explicitly requested blush, moist highlights, or tears;
4. keep canvas, placement, pose, hands, body proportions, hair silhouette, costume, linework, lighting, and flat key background unchanged;
5. never derive an expression from another expression and never blend different pose bases;
6. normalize with `<run>/pose-transforms/<mapped-pose>.json`;
7. compare against the mapped approved pose outside the configured face region.

```bash
python "$SKILL_DIR/scripts/sprite_tools.py" compare \
  <mapped-pose-final> <expression-final> \
  --face-box 0.22,0.02,0.78,0.24 \
  --json <run>/qa/<expression>-drift.json
```

Retry a failed expression once with a shorter “change only the face” prompt. Do not silently loop. If the retry still changes material non-face details, show the best result with the exact warning.

## Deliver stable outputs

Keep these default outputs:

```text
<slug>_reference_normal.png
<slug>_normal.png
<slug>_engaged_normal.png
<slug>_firm_normal.png
<slug>_reserved_normal.png
<slug>_smile.png
<slug>_laugh.png
<slug>_angry.png
<slug>_sad.png
<slug>_surprised.png
<slug>_shy.png
manifest.json
```

Register all seven runtime expressions. The `normal` path must hash-identically match the approved neutral pose mapped to `normal`:

```bash
python "$SKILL_DIR/scripts/run_state.py" <run>/manifest.json complete \
  --output normal=<run>/<slug>_normal.png \
  --output smile=<run>/<slug>_smile.png \
  --output laugh=<run>/<slug>_laugh.png \
  --output angry=<run>/<slug>_angry.png \
  --output sad=<run>/<slug>_sad.png \
  --output surprised=<run>/<slug>_surprised.png \
  --output shy=<run>/<slug>_shy.png
```

Keep chroma sources, prompt files, per-pose transforms, and QA reports for reproducibility. Deliver a pose preview and a seven-expression preview. Report exact observed key colors, canvas size, prompt set, and warnings.

## Preserve portability

Keep provider calls outside prompt construction, state transitions, and image processing. Read [portable-architecture.md](references/portable-architecture.md) when moving the workflow into another project. Use `scripts/gpt_image2_adapter.py` only when the user explicitly chooses API mode and has `OPENAI_API_KEY`; Work/Codex stays on the built-in path by default.
