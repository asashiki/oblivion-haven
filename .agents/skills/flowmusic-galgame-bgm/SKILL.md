---
name: flowmusic-galgame-bgm
description: Create and refine Flowmusic prompts for Galgame, visual-novel, WebGAL, blog-game, and character-dialogue background music. Use when the user wants AI-generated BGM that must stay unobtrusive under dialogue, loop naturally for minutes, avoid song-like buildup/climax/outro behavior, or match scenes such as daily conversation, character themes, quiet night, seaside/lighthouse rooms, comedy, mystery, emotional restraint, and Meta/system moments. Also use to diagnose bad Flowmusic generations such as excessive development, dramatic percussion, orchestral swells, abrupt transitions, over-dense instrumentation, or endings that break looping.
---

# Flowmusic Galgame BGM

Generate prompts as functional game-audio instructions, not as prose about a beautiful song.

## Core rule

Treat ordinary Galgame BGM as a reusable dialogue bed. Prioritize loopability, stability, low distraction, and structural restraint over musical spectacle.

For most dialogue BGM, explicitly constrain the model to:
- keep one stable mood, tempo, instrumentation, and dynamic level;
- use a short repeating motif or small repeating phrase;
- minimize harmonic and arrangement development;
- avoid intro/outro logic and strong ending cadences;
- avoid climax, buildup, breakdown, modulation, dramatic transitions, orchestral swells, and sudden percussion;
- remain suitable under 2–4 minutes of spoken dialogue and seamless repetition.

Do not assume that descriptive mood words alone will produce usable game BGM. Structural constraints are usually more important than atmosphere adjectives.

## Prompt construction

Build the prompt in this order:

1. **Function** — state that it is Japanese Galgame / visual-novel dialogue BGM, character BGM, menu BGM, etc.
2. **Scene and mood** — use only the few scene traits that materially affect the sound.
3. **Instrumentation** — normally choose 2–4 common instruments. Do not stack many decorative elements.
4. **Behavior** — specify repeating motif, stable tempo/dynamics, low density, minimal development, and seamless loop.
5. **Negative structure constraints** — explicitly forbid unwanted song-like structure.

Prefer compact, concrete language over poetic worldbuilding.

## Instrument discipline

For ordinary scenes, prefer small combinations such as:
- soft piano + acoustic guitar + light bass;
- piano + pizzicato strings + light percussion;
- soft piano + ambient pad;
- acoustic guitar + bass + restrained percussion.

Only add unusual textures when they serve a clear scene function. Do not combine every worldbuilding idea into the instrumentation.

## Word-choice guidance

Useful structural phrases:
- `functional dialogue background music`
- `unobtrusive under long conversations`
- `simple repeating motif`
- `short repeating phrase`
- `static arrangement`
- `stable tempo and stable dynamics`
- `minimal harmonic development`
- `consistent energy throughout`
- `low melodic density`
- `seamless loop`
- `no intro or outro`
- `no strong ending cadence`

Use care with words such as `cinematic`, `epic`, `emotional`, `energetic`, `dramatic`, `powerful`, `rich`, or `evolving`: they often encourage excessive development. If a user asks for emotion, keep it restrained unless the scene is intentionally a climax.

## Default negative constraints for dialogue BGM

Select only the relevant constraints, but ordinary looping BGM often benefits from:

`No climax, no buildup, no breakdown, no dramatic transitions, no key changes, no orchestral swell, no large dynamic changes, no sudden percussion, no solo sections, no intro or outro, no big ending, no strong ending cadence.`

Do not blindly append every negative phrase if the requested scene needs some of those features.

## Output behavior

When the user asks for "a prompt", return one ready-to-paste English prompt in a code block with little or no explanation.

When the user asks for variants, make the variants meaningfully different in mood or instrumentation while preserving the same functional loop constraints.

When the user reports a bad generation, diagnose the failure in terms of structure first: development, dynamics, percussion, instrumentation density, transition behavior, cadence, or loop seam. Then rewrite the prompt rather than merely adding more atmosphere words.

For common recipes and examples, read `references/prompt-patterns.md`.
