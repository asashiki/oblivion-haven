import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { analyseAudioSamples, decodePcm16Wav } from "../lib/figure-motion/audioEnvelope";
import { buildMouthTimeline } from "../lib/figure-motion/mouthTimeline";
import type { FacialMotionPackageV2 } from "../lib/figure-motion/schema";

const root = resolve(process.argv[2] || "tests/fixtures/face-motion-demo");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as FacialMotionPackageV2;
const wav = new Uint8Array(await readFile(resolve(root, "voice.wav")));
const decoded = decodePcm16Wav(wav);
const envelope = analyseAudioSamples(decoded.samples, decoded.sampleRate, manifest.profile.mouth);
const timeline = buildMouthTimeline(envelope, manifest.profile.mouth);

await writeFile(resolve(root, "audio-envelope.json"), `${JSON.stringify(envelope, null, 2)}\n`);
await writeFile(resolve(root, "mouth-timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`);
console.log(JSON.stringify({ durationMs: timeline.durationMs, frames: envelope.frames.length, segments: timeline.segments.length }));
