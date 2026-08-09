# Third-party notices

## WebGAL engine

Formal exports bundle the browser distribution from the exact npm dependency
`webgal-engine@4.6.2` under `vendor/webgal/`.

- Upstream repository: <https://github.com/OpenWebGAL/WebGAL/tree/4.6.2>
- Package: <https://www.npmjs.com/package/webgal-engine/v/4.6.2>
- License: Mozilla Public License 2.0 (MPL-2.0)

`scripts/prepare-webgal-runtime.mjs` copies the non-precompressed runtime files,
the upstream license, and writes a SHA-256 runtime manifest. Studio export does
not modify the bundled engine files.

## WebGAL animation presets

The files emitted under `game/animation/` are adapted from the official
`OpenWebGAL/WebGAL_Terre` project template:

`packages/terre2/assets/templates/WebGAL_Template/game/animation`

- Upstream repository: <https://github.com/OpenWebGAL/WebGAL_Terre>
- License: Mozilla Public License 2.0 (MPL-2.0)
- Upstream license: <https://github.com/OpenWebGAL/WebGAL_Terre/blob/main/LICENSE>

The preset animation frame data is kept in
`lib/story/performancePresets.ts`. Local changes are limited to representing
the JSON data as TypeScript constants so the compiler can emit a complete
WebGAL game package.
