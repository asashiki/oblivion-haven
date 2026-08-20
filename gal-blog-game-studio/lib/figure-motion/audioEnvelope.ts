import type { MouthProfile } from "./schema";

export type EnvelopeFrame = {
  timeMs: number;
  rms: number;
  normalized: number;
  smoothed: number;
};

export type AudioEnvelope = {
  durationMs: number;
  sampleRate: number;
  noiseFloor: number;
  stablePeak: number;
  frames: EnvelopeFrame[];
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function percentile(values: number[], position: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(position) * (sorted.length - 1);
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

export function analyseAudioSamples(samples: Float32Array, sampleRate: number, profile: MouthProfile): AudioEnvelope {
  const windowSamples = Math.max(1, Math.round(sampleRate * profile.windowMs / 1000));
  const rmsValues: number[] = [];
  for (let start = 0; start < samples.length; start += windowSamples) {
    const end = Math.min(samples.length, start + windowSamples);
    let energy = 0;
    for (let index = start; index < end; index += 1) energy += samples[index] * samples[index];
    rmsValues.push(Math.sqrt(energy / Math.max(1, end - start)));
  }
  const noiseFloor = percentile(rmsValues, profile.noiseFloorPercentile);
  const stablePeak = Math.max(noiseFloor + 1e-6, percentile(rmsValues, profile.peakPercentile));
  let smoothed = 0;
  const frames = rmsValues.map((rms, index): EnvelopeFrame => {
    const normalized = clamp((rms - noiseFloor) / (stablePeak - noiseFloor));
    const tau = normalized > smoothed ? profile.attackMs : profile.releaseMs;
    const alpha = tau <= 0 ? 1 : 1 - Math.exp(-profile.windowMs / tau);
    smoothed += (normalized - smoothed) * alpha;
    return { timeMs: index * profile.windowMs, rms, normalized, smoothed };
  });
  return {
    durationMs: samples.length / sampleRate * 1000,
    sampleRate,
    noiseFloor,
    stablePeak,
    frames,
  };
}

export function decodePcm16Wav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length));
  if (bytes.byteLength < 44 || text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") throw new Error("只支持标准 WAV 文件。");
  let offset = 12;
  let formatOffset = -1;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= bytes.byteLength) {
    const type = text(offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (type === "fmt ") formatOffset = offset + 8;
    if (type === "data") {
      dataOffset = offset + 8;
      dataLength = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (formatOffset < 0 || dataOffset < 0) throw new Error("WAV 缺少 fmt 或 data 区块。");
  const format = view.getUint16(formatOffset, true);
  const channels = view.getUint16(formatOffset + 2, true);
  const sampleRate = view.getUint32(formatOffset + 4, true);
  const bits = view.getUint16(formatOffset + 14, true);
  if (format !== 1 || bits !== 16 || channels < 1) throw new Error("当前 fixture 只支持 PCM16 WAV。");
  const frameCount = Math.floor(dataLength / (channels * 2));
  const samples = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let mixed = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      mixed += view.getInt16(dataOffset + (frame * channels + channel) * 2, true) / 32768;
    }
    samples[frame] = mixed / channels;
  }
  return { samples, sampleRate };
}
