# scripts

Cutout / normalize / validate / rekey for this skill use the same `sprite_tools.py` as the sibling skill:

```text
../generate-galgame-sprite-diffs/scripts/sprite_tools.py
```

When running from a checked-out repo:

```bash
SKILL_DIR=.agents/skills/grok-galgame-sprites
TOOLS=.agents/skills/generate-galgame-sprite-diffs/scripts/sprite_tools.py

python "$TOOLS" cutout <chroma> <out.png> \
  --key-color '#FF00FF' --scope all \
  --soft-matte --despill --auto-refine \
  --auto-refine-max-alpha-loss 0.025
```

A full copy of `sprite_tools.py` is also available in the local Grok skill install and in `artifacts/grok-galgame-sprites.zip` if you need a standalone tree without the Codex skill present.
