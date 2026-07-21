---
name: generate-galgame-sprite-diffs
description: Generate consistency-locked Galgame full-body character expression variants from uploaded character art or a character prompt, using a two-stage approval gate, flat chroma-key sources, local background removal, validation, stable naming, and an optional gpt-image-2 portability path. Use for transparent Galgame standing sprites, character expression differentials or 差分立绘, a neutral base followed by smile/laugh variants, or requests to standardize this workflow in ChatGPT Work or Codex.
---

# Generate Galgame Sprite Diffs

Create one approved canonical standing sprite before generating expression variants. Treat the canonical sprite—not the original loose reference—as the edit target for every later expression.

## Keep the two-stage contract

Use these states:

1. `BASE_PENDING`: collect inputs and generate only `normal`.
2. `BASE_REVIEW`: show the transparent normal sprite and stop.
3. `VARIANTS_PENDING`: enter only after the user explicitly approves or chooses “生成表情差分”.
4. `COMPLETE`: deliver `normal`, `smile`, and `laugh` plus the run manifest.

Never generate `smile` or `laugh` in the first stage. If the user rejects the base, replace the base and reset all later variants.

## Prepare the run

Require either at least one character reference image or a character-description prompt. Inspect each reference once before generation and assign an explicit role:

- `primary-character`: the single highest-authority source for identity, apparent age, face geometry, head-to-body ratio, leg-to-torso ratio, build, costume, palette, accessories, and art style;
- `supporting-character`: another view of the same character used only to recover hidden details;
- `detail-style`: linework, eye/hair detail, and shading finish only; never face shape, age, anatomy, expression, blush, lighting, crop, or pose;
- `pose-only`: pose only, never identity or anatomy;
- canonical edit target: the approved chroma-key normal sprite used for variants.

When the config uses the legacy array of plain paths, treat the first image as `primary-character` and later images as `supporting-character`. For precise multi-reference work, use role objects in the same order passed to image generation:

```json
"reference_images": [
  {"path": "character-sheet.png", "role": "primary-character"},
  {"path": "face-detail.png", "role": "detail-style"}
]
```

When references disagree, the primary image wins. A more detailed secondary face image may improve rendering finish but must never mature, slim, lengthen, or otherwise redesign the primary character.

The canonical `normal` output must be one full-body character in a calm standard standing pose, with the complete head, hair, accessories, and both shoes visible, arms relaxed, hands visible, both eyes open, and the mouth fully closed. Treat the source pose, crop, gesture, expression, props, and background as incidental. Reconstruct non-standard inputs while preserving the primary reference's exact identity, apparent age, face shape, head size, head-to-body ratio, torso length, leg-to-torso ratio, limb thickness, costume, palette, accessories, and drawing style.

Treat “standard standing pose” as a pose and framing conversion only. Never normalize anatomy toward realistic, adult, fashion-model, taller, slimmer, smaller-headed, or longer-legged proportions. Never age the character up. Do not infer height from source canvas occupancy. If cropped or occluded anatomy is ambiguous, choose the compact interpretation most consistent with the visible face, anatomy, and original Japanese anime style; never resolve ambiguity by lengthening the legs or maturing the face.

Create a dedicated run directory. Start from [default-config.json](references/default-config.json), change only user-supplied or clearly inferable values, and preserve any user-listed invariants verbatim. Use a filesystem-safe `character.slug`.

Resolve `SKILL_DIR` to the absolute directory containing this `SKILL.md`. Use it for every bundled script or reference; do not assume the current working directory is the skill directory.

```bash
cp "$SKILL_DIR/references/default-config.json" <run>/config.json
```

Default to a portrait `1024x1536` canvas, high quality, bottom-center anchoring, 6% safe margin, and these v1 expressions:

- `normal`: mouth closed, eyes open, calm standard stance;
- `smile`: eyes open, gentle friendly smile, mouth slightly open;
- `laugh`: joyful open smile, eyes curved into crescents or naturally closed.

Choose a chroma key before writing prompts. Treat script scoring as a proposal, not the final judgment:

```bash
KEY_COLOR="$(python "$SKILL_DIR/scripts/sprite_tools.py" choose-key \
  <character-reference> --preferred '#fc5d21' --plain \
  --json <run>/qa/key-selection.json)"
```

Use `#fc5d21` when there is no reference and it does not conflict with the written character palette. Otherwise choose a candidate far from the character colors. Never knowingly use a key color present in hair, eyes, skin accents, clothing, accessories, or effects.

Visually veto colors that collide with small but important regions or soft edges even when their whole-image score is high. Check eyes, hair tips, translucent strands, ribbons, reflective trim, and antialiased outlines separately. If the supplied reference already has a simple flat or near-flat background that is cleanly separated from the character, prefer reusing that hue when safe; for example, keep a purple key for a blonde character with green or teal eyes instead of switching to green. Record the reason for any override in the run manifest.

Build deterministic prompts and the initial manifest:

```bash
python "$SKILL_DIR/scripts/build_prompts.py" \
  --config <run>/config.json \
  --key-color "$KEY_COLOR" \
  --out <run>
```

## Generate and review the normal sprite

Use the built-in image-generation capability by default so Work/Codex does not need an API key. In Codex, route image creation and edits through the built-in `$imagegen` skill; in Work, use the available built-in image-generation tool. Only use the API adapter when the user explicitly chooses API mode. Inspect each local reference image before passing it to image generation.

Issue exactly one image-generation call for the normal sprite. Use `<run>/prompts/normal.txt` as the prompt. Pass character references as references/edit inputs in the same order as the role-labeled config, not as images to reproduce wholesale. Require one full body, crown-to-shoes visibility, generous padding, no props unless identity-defining, and a perfectly flat key-color background.

Save the opaque source as:

```text
<run>/source/<slug>_normal_key.png
```

Keep this file. It becomes the canonical edit target after approval.

Remove the key, normalize the canvas, and validate:

```bash
python "$SKILL_DIR/scripts/sprite_tools.py" cutout \
  <run>/source/<slug>_normal_key.png \
  <run>/working/<slug>_normal_cutout.png \
  --scope all --soft-matte --despill \
  --json <run>/qa/normal-cutout.json

OBSERVED_KEY="$(python -c \
  'import json, sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["key_color"])' \
  <run>/qa/normal-cutout.json)"

python "$SKILL_DIR/scripts/sprite_tools.py" normalize \
  <run>/working/<slug>_normal_cutout.png \
  <run>/<slug>_normal.png \
  --canvas 1024x1536 --margin-percent 6 \
  --write-transform <run>/base-transform.json

python "$SKILL_DIR/scripts/sprite_tools.py" validate \
  <run>/<slug>_normal.png --expect-size 1024x1536 \
  --key-color "$OBSERVED_KEY" --json <run>/qa/normal.json

python "$SKILL_DIR/scripts/run_state.py" <run>/manifest.json base-ready \
  --source <run>/source/<slug>_normal_key.png \
  --final <run>/<slug>_normal.png
```

Use local pixel validation to confirm clean alpha, complete canvas bounds, and transparent holes enclosed by hair, ribbons, arms, or clothing. Require validation to scan for opaque key-colored pixels anywhere inside the visible bounding area, not only at corners or soft edges. In the default cost-conscious flow, do not reopen the generated result with a separate visual-model inspection; show the transparent PNG to the user, who decides identity, apparent age, face, costume, and proportions at `BASE_REVIEW`. Add targeted visual inspection only if local QA fails or the user requests it.

Treat `KEY_COLOR` as the requested prompt color, not a promise of exact
output pixels. Omit `--key-color` during cutout so the script samples the
actual generated border color for that source. Keep the configured thresholds
constant and record both the requested key in `manifest.json` and the observed
key in the cutout QA report. Validate each transparent output against the
observed key from its own cutout report. Never validate a re-keyed or separately
generated source with the base image's requested or observed key.

If a key conflict is discovered after the base is approved, keep the approved source immutable. Re-key the pre-normalization transparent cutout locally instead of asking the model to redraw or recolor the whole sprite:

```bash
python "$SKILL_DIR/scripts/sprite_tools.py" rekey \
  <run>/working/<slug>_normal_cutout.png \
  <run>/source/<slug>_normal_rekey.png \
  --key-color '<new-key>' --json <run>/qa/normal-rekey.json
```

Use that derived opaque file as the variant edit target and record both the original and replacement key colors. Because it is derived before normalization, continue applying `<run>/base-transform.json` to the variant cutouts as usual.

Show the transparent normal sprite and summarize its configuration. Explicitly ask the user to check likeness, apparent age, face shape, head-to-body ratio, and leg length before approval. Any report that the character looks older, taller, slimmer, smaller-headed, or longer-legged is a base rejection: reset and regenerate `normal`; never defer that correction to expression variants. Offer “生成表情差分” and “重做通常立绘” choices when the current surface supports action choices; otherwise ask the user to reply with one of those phrases. Stop and wait.

## Generate expression variants after approval

Use the approved opaque chroma source—not its transparent derivative—as the sole canonical edit target. Generate `smile` and `laugh` with two separate image-generation calls. Do not use `n` to make distinct expressions.

First lock the exact previewed base hash:

```bash
python "$SKILL_DIR/scripts/run_state.py" <run>/manifest.json approve
```

For each call:

1. Pass `<run>/source/<slug>_normal_key.png` as the edit target.
2. Use the corresponding prompt under `<run>/prompts/`.
3. Change only the requested facial expression.
4. Lock canvas, pixel placement, pose, hands, body proportions, hair silhouette, costume seams and ornaments, accessories, linework, shading, lighting, and the exact flat key background.
5. Save the opaque result under `<run>/source/<slug>_<expression>_key.png`.
6. Request the same prompt key, then sample that generated source's actual border color during cutout and normalize with `<run>/base-transform.json`.
7. Validate the result with the observed key from that expression's own cutout QA report, then compare it with the approved base outside the configured face region.

Use `--scope all` for every normal and expression source so key-colored
background islands enclosed by hair, ribbons, arms, or clothing also become
transparent. Use `border-connected` only after the user explicitly accepts
that the chosen key collides with a real subject color; normally choose a new
key instead.

Use:

```bash
python "$SKILL_DIR/scripts/sprite_tools.py" normalize \
  <variant-cutout> <final-variant> \
  --transform <run>/base-transform.json

python "$SKILL_DIR/scripts/sprite_tools.py" compare \
  <run>/<slug>_normal.png <final-variant> \
  --face-box 0.22,0.02,0.78,0.24 \
  --json <run>/qa/<expression>-drift.json
```

Retry a failed expression once with a shorter, stricter “change only the face” prompt. Do not silently loop. If the second attempt still changes material non-face details, show the best result with the QA warning and explain the exact drift; never claim pixel-identical preservation.

## Deliver stable outputs

Use these final names:

```text
<slug>_normal.png
<slug>_smile.png
<slug>_laugh.png
manifest.json
```

Keep chroma sources and QA files inside the run directory for reproducibility. Generate an optional checkerboard contact sheet with:

```bash
python "$SKILL_DIR/scripts/sprite_tools.py" sheet \
  <run>/<slug>_normal.png \
  <run>/<slug>_smile.png \
  <run>/<slug>_laugh.png \
  --out <run>/<slug>_expressions_preview.png

python "$SKILL_DIR/scripts/run_state.py" <run>/manifest.json complete \
  --normal <run>/<slug>_normal.png \
  --smile <run>/<slug>_smile.png \
  --laugh <run>/<slug>_laugh.png
```

Report the final paths, exact key color, canvas size, final prompt set, and any drift warnings.

## Preserve portability

Keep provider calls outside prompt construction and image processing. Use [portable-architecture.md](references/portable-architecture.md) when moving the workflow into another project. Use `scripts/gpt_image2_adapter.py` only when the user explicitly chooses API mode and has `OPENAI_API_KEY`; Work/Codex stays on the built-in path by default.

The bundled adapter intentionally omits `input_fidelity` for `gpt-image-2`, retains chroma keying because that model does not currently accept transparent output, and exposes a `--dry-run` mode for request inspection.
