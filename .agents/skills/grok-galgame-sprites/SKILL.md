---
name: grok-galgame-sprites
description: Generate consistency-locked Galgame full-body standing sprites with solid #FF00FF chroma background using Grok Imagine 2.0, then cut out to transparent PNGs. Use for transparent Galgame 立绘, pose or expression sprites, maid or character sheet production, chroma cutout, or when the user wants Grok-side sprite generation without WebGAL eye/mouth runtime differentials.
---

# Grok Galgame Sprites

Grok-side workflow for transparent Galgame standing sprites. Built from the real pipeline used on `maid_princess` and similar runs.

This is **not** the Codex `generate-galgame-sprite-diffs` skill. That skill targets WebGAL eye/mouth forced composites and browser lip-sync. **This skill does not produce runtime blink or mouth-sync parts.** It stops at approved transparent full-body mothers (reference, poses, expressions).

## What this skill produces

- `reference_normal` — identity lock, full-body, closed mouth, open eyes
- several **pose bases** — distinct neutral stances, still closed mouth / open eyes
- several **expression mothers** — face emotion on a mapped pose; body stays locked
- all as **transparent PNG** on a shared 1024×1536 canvas
- contact sheets + simple inventory/README for download

## What this skill does NOT produce

- WebGAL `eyes_close` / `eyes_half` / `mouth_half_open` / `mouth_open` runtime frames
- local replacement parts for blink or lip-sync
- GIF demos of speaking or blinking
- forced local composite (`outside_mask_changed_pixels` pipeline)

If the user later asks for blink/mouth differential, say clearly that Grok Imagine full-body regenerations drift enough that local eye/mouth paste is unreliable, and keep those requests out of this skill’s default path.

## Hard invariants

1. **Key color is always solid `#FF00FF`.** No gradients. No auto key picker. User preference is fixed magenta so cutout is deterministic.
2. **Canvas is always 1024×1536** with about 6% margin after normalize.
3. **Generate on chroma, cut out after.** Never treat a gray or photo background as final.
4. **One identity lock.** Primary reference wins for age, proportions, face, costume, palette, style. Do not adult-ify or genericize a petite/chibi design.
5. **Review gates.** Stop for approval after reference, after pose group, after expression group. Do not silently advance.

## Tooling

- **Image generation / edit:** Grok Imagine via `edit_image` (preferred for identity-preserving pose and expression edits) or `generate_image` when no source exists yet.
- **Cutout / normalize / validate / rekey:** `scripts/sprite_tools.py` in this skill directory.

Resolve `SKILL_DIR` to this `SKILL.md` folder.

```bash
python "$SKILL_DIR/scripts/sprite_tools.py" cutout \
  <chroma-source> <out-transparent.png> \
  --key-color '#FF00FF' --scope all \
  --soft-matte --despill --auto-refine \
  --auto-refine-max-alpha-loss 0.025

python "$SKILL_DIR/scripts/sprite_tools.py" normalize \
  <transparent.png> <final-1024x1536.png> \
  --canvas 1024x1536 --margin-percent 6

python "$SKILL_DIR/scripts/sprite_tools.py" validate \
  <final.png> --expect-size 1024x1536 --key-color '#FF00FF'

python "$SKILL_DIR/scripts/sprite_tools.py" rekey \
  <transparent.png> <chroma-out.png> --key-color '#FF00FF'
```

If residual magenta fringe remains on fine hair or lace after a normal cutout, run a **stronger** pass (higher opaque distance / extra despill) and compare alpha area loss. Keep the stronger result only when fringe is gone and silhouette is not eaten.

Always sample the actual border of a generated chroma image. Grok Imagine sometimes returns a near-magenta that is not exact `#FF00FF`; pass the sampled color into cutout when needed.

## Stage flow

```
BASE_PENDING → BASE_REVIEW
POSES_PENDING → POSES_REVIEW
EXPRESSIONS_PENDING → EXPRESSIONS_REVIEW
COMPLETE (export transparent pack)
```

### 1. Reference (`reference_normal`)

If the user supplies a front character sheet:

1. Use `edit_image` to replace **only the background** with pure solid `#FF00FF`. Do not redesign the character.
2. Cut out → normalize → validate.
3. Show transparent result and stop for approval.

If there is no image, generate one full-body front stance on pure `#FF00FF` with a tight identity prompt, then the same cutout path.

Reject age-up, leg stretch, costume rewrite, or face drift.

### 2. Pose bases

Default lean set (override only when the user asks):

| id | intent |
|----|--------|
| `idle` | relaxed asymmetrical conversational stance |
| `side` | clear three-quarter lean (~25–35° body), face still readable, eyes to viewer |
| `reserved` | inward, hands gathered, narrower stance |

Optional extras used successfully in production: `note` (holding a small paper and reading), `welcome` (open greeting hands), `guide` (side-lean with one hand raised as if presenting).

Rules:

- Generate **each pose independently** from the approved reference chroma via `edit_image`. Never chain pose → pose.
- Keep **eyes open, mouth closed** (faint closed-lip curve OK).
- Poses must differ in hands, shoulders, torso axis, hips, and feet — not only one hand.
- After cutout + normalize, build a contact sheet. Stop at `POSES_REVIEW`.

Prompt pattern (keep identity locked):

```text
Precise full-body edit. Same character identity, age, proportions, costume, colors, pure solid #FF00FF background.
Change ONLY the pose to: <pose description>.
Eyes open, mouth fully closed. No other redesign.
```

### 3. Expression mothers

Map expressions to an approved pose (example defaults):

| expression | from pose | notes |
|------------|-----------|-------|
| laugh | side | may keep closed eyes as part of the expression |
| thinking | side | may keep closed eyes |
| angry | idle | |
| sad | reserved | |
| surprised | side | |
| shy | reserved | |

Rules:

- Edit from the **mapped pose’s chroma**, not from another expression.
- Change **face only** (and blush / highlights if needed). Body, hands, costume stay fixed.
- After cutout, prefer reusing the pose’s normalize transform when alignment is already good; otherwise normalize independently and check silhouette.
- Contact sheet of all expressions → `EXPRESSIONS_REVIEW`.

Prompt pattern:

```text
Precise face-only edit. Same body, pose, hands, costume, pure solid #FF00FF background.
Change ONLY the facial expression to: <emotion>.
Do not move the body or redesign clothing.
```

### 4. Export pack

At `COMPLETE`, assemble a download folder:

```text
<slug>_sprites/
  chroma/          # optional #FF00FF sources
  cutout/          # final transparent 1024×1536 PNGs
  previews/        # contact sheets
  README.md
  inventory.json
```

README should list every sprite, key color, canvas size, and state that runtime blink/mouth is **out of scope** for this pack.

## Cutout quality checklist

Before approving any mother:

- Hair tips and flyaways are not chopped into magenta blocks
- Pale clothing / white apron has no pink halo
- Enclosed gaps (between arm and body, under skirt) are transparent where they should be
- No large residual key fringe on the outline
- Validate reports residual key edge near zero when possible

If fringe remains, run the stronger cutout variant and show a before/after edge zoom. Keep stronger only when it clearly helps.

## Practical notes from production

- Gray or non-chroma backgrounds on source images cause color shift (e.g. blonde → pink). Always force `#FF00FF` first with `edit_image`, then cut out.
- Grok Imagine 2.0 is strong at identity-preserving pose and expression edits when the prompt is strict and the input is already chroma.
- Full-body regenerations always drift a few pixels. That is acceptable for whole-sprite mothers; it is why this skill refuses local eye/mouth differential.
- Prefer parallel `edit_image` calls for a pose group or expression group when the tool allows, then cut out sequentially.

## Relation to the Codex skill

| topic | Codex `generate-galgame-sprite-diffs` | This skill |
|-------|----------------------------------------|------------|
| generator | Codex / GPT image path | Grok Imagine 2.0 (`edit_image` / `generate_image`) |
| key color | auto choose + preferred | fixed `#FF00FF` |
| poses + expressions | yes | yes |
| WebGAL eye/mouth runtime | yes (forced local composite) | **no** |
| blink / lip-sync parts | yes | **no** |
| deliverable focus | figures + parts + runtime compositor | transparent mothers + contact sheets |

Keep both skills in the repo. Route users who only need standing sprites and expressions to this one. Route WebGAL mouth-sync / blink packaging to the Codex skill when that environment is available.
