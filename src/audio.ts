/** Planar floating-point PCM. Selection boundaries are integer sample frames. */
export interface PCM {
  channels: Float32Array[];
  sampleRate: number;
}
export interface Edit {
  start: number;
  end: number;
  fadeIn: number;
  fadeOut: number;
  normalize: boolean;
  targetDb: number;
}
export interface Metrics {
  peak: number;
  rms: number;
  clippedSamples: number;
  samples: number;
}
export interface Rendered {
  pcm: PCM;
  metrics: Metrics;
  gain: number;
}
export const MAX_SECONDS = 90;
export const MAX_FILE_BYTES = 40 * 1024 * 1024;
export const MAX_SAMPLES = 18_000_000;

export function validatePCM(pcm: PCM): number {
  if (
    !Number.isInteger(pcm.sampleRate) ||
    pcm.sampleRate < 8000 ||
    pcm.sampleRate > 192000
  )
    throw new Error("Sample rate must be between 8,000 and 192,000 Hz.");
  if (pcm.channels.length < 1 || pcm.channels.length > 2)
    throw new Error("Choose a mono or stereo recording.");
  const frames = pcm.channels[0].length;
  if (!frames || pcm.channels.some((c) => c.length !== frames))
    throw new Error("Audio channels must have the same, non-zero length.");
  if (
    frames / pcm.sampleRate > MAX_SECONDS ||
    frames * pcm.channels.length > MAX_SAMPLES
  )
    throw new Error(
      "Choose a recording up to 90 seconds (18 million decoded samples).",
    );
  for (const channel of pcm.channels)
    for (const sample of channel)
      if (!Number.isFinite(sample))
        throw new Error("The audio contains invalid sample values.");
  return frames;
}

export function validateEdit(edit: Edit, length: number): void {
  if (
    !Number.isInteger(edit.start) ||
    !Number.isInteger(edit.end) ||
    edit.start < 0 ||
    edit.end > length ||
    edit.end <= edit.start
  )
    throw new Error("Choose a selection with at least one sample frame.");
  for (const fade of [edit.fadeIn, edit.fadeOut])
    if (!Number.isFinite(fade) || fade < 0 || fade > MAX_SECONDS)
      throw new Error("Fade times must be finite, between 0 and 90 seconds.");
  if (
    !Number.isFinite(edit.targetDb) ||
    edit.targetDb > 0 ||
    edit.targetDb < -24
  )
    throw new Error("Peak target must be between −24 and 0 dBFS.");
  if (typeof edit.normalize !== "boolean")
    throw new Error("Normalization must be enabled or disabled.");
}

/** RMS is over every sample in every channel. This is not loudness or true peak. */
export function measure(pcm: PCM): Metrics {
  let peak = 0,
    sum = 0,
    clippedSamples = 0,
    samples = 0;
  for (const channel of pcm.channels)
    for (const sample of channel) {
      if (!Number.isFinite(sample))
        throw new Error("The audio contains invalid sample values.");
      const absolute = Math.abs(sample);
      peak = Math.max(peak, absolute);
      sum += sample * sample;
      if (absolute > 1) clippedSamples++;
      samples++;
    }
  return {
    peak,
    rms: samples ? Math.sqrt(sum / samples) : 0,
    clippedSamples,
    samples,
  };
}

export function db(value: number): string {
  return value === 0
    ? "−∞"
    : (20 * Math.log10(value)).toFixed(1).replace("-", "−");
}

/** Linear fades are multiplied when they overlap. Stereo gain is linked. */
export function render(pcm: PCM, edit: Edit): Rendered {
  const length = validatePCM(pcm);
  validateEdit(edit, length);
  const frames = edit.end - edit.start;
  const fadeInFrames = Math.min(
    frames,
    Math.round(edit.fadeIn * pcm.sampleRate),
  );
  const fadeOutFrames = Math.min(
    frames,
    Math.round(edit.fadeOut * pcm.sampleRate),
  );
  const channels = pcm.channels.map((channel) => {
    const out = channel.slice(edit.start, edit.end);
    for (let i = 0; i < frames; i++) {
      let envelope = 1;
      if (fadeInFrames > 0 && i < fadeInFrames)
        envelope *= fadeInFrames === 1 ? 0 : i / (fadeInFrames - 1);
      if (fadeOutFrames > 0 && i >= frames - fadeOutFrames)
        envelope *=
          fadeOutFrames === 1 ? 0 : (frames - 1 - i) / (fadeOutFrames - 1);
      out[i] *= envelope;
    }
    return out;
  });
  const output = { channels, sampleRate: pcm.sampleRate };
  const initial = measure(output);
  const gain =
    edit.normalize && initial.peak > 0
      ? Math.pow(10, edit.targetDb / 20) / initial.peak
      : 1;
  if (gain !== 1)
    for (const channel of channels)
      for (let i = 0; i < channel.length; i++) channel[i] *= gain;
  return { pcm: output, metrics: measure(output), gain };
}

/** Saturating, interleaved PCM16. Negative full scale is −32768, positive is 32767. */
export function encodeWav(pcm: PCM): ArrayBuffer {
  const frames = validatePCM(pcm),
    channels = pcm.channels.length;
  const bytes = frames * channels * 2;
  const buffer = new ArrayBuffer(44 + bytes),
    view = new DataView(buffer);
  const ascii = (offset: number, word: string) =>
    [...word].forEach((char, i) =>
      view.setUint8(offset + i, char.charCodeAt(0)),
    );
  ascii(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, pcm.sampleRate, true);
  view.setUint32(28, pcm.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, bytes, true);
  for (let frame = 0; frame < frames; frame++)
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.max(-1, Math.min(1, pcm.channels[channel][frame]));
      view.setInt16(
        44 + (frame * channels + channel) * 2,
        Math.round(sample * (sample < 0 ? 32768 : 32767)),
        true,
      );
    }
  return buffer;
}

/** Preview exactly the saturated, quantized samples that PCM16 export will contain. */
export function quantize(pcm: PCM): PCM {
  return {
    sampleRate: pcm.sampleRate,
    channels: pcm.channels.map((channel) =>
      Float32Array.from(channel, (value) => {
        const sample = Math.max(-1, Math.min(1, value));
        const integer = Math.round(sample * (sample < 0 ? 32768 : 32767));
        return integer / 32768;
      }),
    ),
  };
}

/** Original, deterministic bell study. No recordings, network requests, or random noise. */
export function demo(): PCM {
  const sampleRate = 44100,
    frames = sampleRate * 18;
  const channels = [new Float32Array(frames), new Float32Array(frames)];
  const notes = [
    60, 67, 71, 74, 67, 64, 60, 59, 62, 69, 74, 76, 71, 67, 64, 62,
  ];
  notes.forEach((midi, note) => {
    const frequency = 440 * 2 ** ((midi - 69) / 12),
      onset = 0.35 + note * 0.9;
    const pan = Math.sin(note * 1.7) * 0.25;
    for (
      let i = Math.floor(onset * sampleRate);
      i < Math.min(frames, (onset + 3.2) * sampleRate);
      i++
    ) {
      const t = i / sampleRate - onset;
      const envelope = (1 - Math.exp(-t * 90)) * Math.exp(-t * 2.2);
      const tone =
        0.29 *
        envelope *
        (Math.sin(2 * Math.PI * frequency * t) +
          0.24 *
            Math.sin(2 * Math.PI * frequency * 2.002 * t) *
            Math.exp(-t * 2));
      channels[0][i] += tone * (1 - pan);
      channels[1][i] += tone * (1 + pan);
    }
  });
  return { channels, sampleRate };
}
