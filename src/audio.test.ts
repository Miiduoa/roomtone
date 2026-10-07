import { describe, expect, it } from "vitest";
import {
  db,
  demo,
  encodeWav,
  measure,
  quantize,
  render,
  validateEdit,
  validatePCM,
} from "./audio";
import type { Edit, PCM } from "./audio";

const pcm = (channels: number[][], sampleRate = 8000): PCM => ({
  channels: channels.map((channel) => new Float32Array(channel)),
  sampleRate,
});
const edit = (length: number, overrides: Partial<Edit> = {}): Edit => ({
  start: 0,
  end: length,
  fadeIn: 0,
  fadeOut: 0,
  normalize: false,
  targetDb: -1,
  ...overrides,
});
const text = (view: DataView, start: number, end: number) =>
  String.fromCharCode(
    ...Array.from({ length: end - start }, (_, i) => view.getUint8(start + i)),
  );

describe("frame selection and envelopes", () => {
  it("uses a half-open frame range and leaves both source channels untouched", () => {
    const input = pcm([
      [0.1, 0.2, 0.3, 0.4],
      [-0.1, -0.2, -0.3, -0.4],
    ]);
    const before = input.channels.map((channel) => [...channel]);
    const result = render(input, edit(4, { start: 1, end: 3 }));
    expect(result.pcm.channels.map((channel) => [...channel])).toEqual(
      before.map((channel) => channel.slice(1, 3)),
    );
    expect(input.channels.map((channel) => [...channel])).toEqual(before);
  });
  it("includes the final frame when the out point is the source length", () => {
    expect([
      ...render(pcm([[0, 0.5, 1]]), edit(3, { start: 2 })).pcm.channels[0],
    ]).toEqual([1]);
  });
  it("has exact zero and unity endpoints for a three-frame linear fade", () => {
    expect([
      ...render(
        pcm([[1, 1, 1, 1, 1, 1]]),
        edit(6, { fadeIn: 3 / 8000, fadeOut: 3 / 8000 }),
      ).pcm.channels[0],
    ]).toEqual([0, 0.5, 1, 1, 0.5, 0]);
  });
  it("multiplies overlapping fades and bounds fade length to the selection", () => {
    expect([
      ...render(pcm([[1, 1, 1]]), edit(3, { fadeIn: 1, fadeOut: 1 })).pcm
        .channels[0],
    ]).toEqual([0, 0.25, 0]);
  });
  it("handles a one-frame fade without NaN or division by zero", () => {
    const result = render(
      pcm([[1]]),
      edit(1, { fadeIn: 1 / 8000, fadeOut: 1 / 8000, normalize: true }),
    );
    expect([...result.pcm.channels[0]]).toEqual([0]);
    expect(result.gain).toBe(1);
  });
  it("rounds a sub-half-frame fade to no fade", () => {
    expect([
      ...render(pcm([[1, 1]]), edit(2, { fadeIn: 0.49 / 8000 })).pcm
        .channels[0],
    ]).toEqual([1, 1]);
  });
});

describe("measurement and linked normalization", () => {
  it("measures sample peak and RMS over every channel sample", () => {
    const result = measure(
      pcm([
        [0, 1],
        [0, 0],
      ]),
    );
    expect(result.peak).toBe(1);
    expect(result.rms).toBe(0.5);
    expect(result.samples).toBe(4);
  });
  it("uses a peak on the right to control one shared gain", () => {
    const result = render(
      pcm([
        [0.125, -0.125],
        [0.5, -0.5],
      ]),
      edit(2, { normalize: true, targetDb: -6 }),
    );
    expect(result.gain).toBeCloseTo(10 ** (-6 / 20) / 0.5, 7);
    expect(result.pcm.channels[1][0] / result.pcm.channels[0][0]).toBe(4);
    expect(result.metrics.peak).toBeCloseTo(10 ** (-6 / 20), 6);
  });
  it("normalizes after applying the envelope", () => {
    const result = render(
      pcm([[1, 0.5, 0.1]]),
      edit(3, { fadeIn: 3 / 8000, normalize: true, targetDb: 0 }),
    );
    expect(result.gain).toBe(4);
    expect([...result.pcm.channels[0]]).toEqual([0, 1, Math.fround(0.4)]);
  });
  it("preserves silence at unity gain and represents negative infinity", () => {
    const result = render(
      pcm([
        [0, 0],
        [0, 0],
      ]),
      edit(2, { normalize: true }),
    );
    expect(result.gain).toBe(1);
    expect(result.metrics.rms).toBe(0);
    expect(db(result.metrics.peak)).toBe("−∞");
  });
  it("counts samples beyond full scale, not exactly at full scale", () => {
    expect(measure(pcm([[-2, -1, 0, 1, 2]])).clippedSamples).toBe(2);
  });
});

describe("PCM16 WAV serialization", () => {
  it("writes a complete mono RIFF header with decoded sample rate", () => {
    const view = new DataView(encodeWav(pcm([[0, 0.5, -0.5]], 44100)));
    expect(view.byteLength).toBe(50);
    expect(text(view, 0, 4)).toBe("RIFF");
    expect(text(view, 8, 12)).toBe("WAVE");
    expect(text(view, 12, 16)).toBe("fmt ");
    expect(text(view, 36, 40)).toBe("data");
    expect(view.getUint32(4, true)).toBe(42);
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(28, true)).toBe(88200);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(6);
  });
  it("interleaves stereo frames and saturates asymmetrical PCM16 limits", () => {
    const view = new DataView(
      encodeWav(
        pcm(
          [
            [-2, -0.5, 2],
            [1, 0.5, -1],
          ],
          48000,
        ),
      ),
    );
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint16(32, true)).toBe(4);
    expect(view.getUint32(28, true)).toBe(192000);
    expect(view.getUint32(40, true)).toBe(12);
    expect(
      Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true)),
    ).toEqual([-32768, 32767, -16384, 16384, 32767, -32768]);
  });
  it("exports only selected frames and includes the last selected sample", () => {
    const result = render(
      pcm([[0, -0.5, 0.5, 1]]),
      edit(4, { start: 1, end: 3 }),
    );
    const view = new DataView(encodeWav(result.pcm));
    expect(view.byteLength).toBe(48);
    expect(view.getUint32(40, true)).toBe(4);
    expect(view.getInt16(44, true)).toBe(-16384);
    expect(view.getInt16(46, true)).toBe(16384);
  });
  it("uses exactly the serialized PCM16 values for processed preview", () => {
    const input = pcm(
      [
        [-1.1, -0.1234, 0, 0.1234, 1.1],
        [0.99, -0.99, 0.5, -0.5, 0],
      ],
      48000,
    );
    const preview = quantize(input),
      view = new DataView(encodeWav(input));
    for (let frame = 0; frame < 5; frame++)
      for (let channel = 0; channel < 2; channel++)
        expect(preview.channels[channel][frame]).toBe(
          view.getInt16(44 + (frame * 2 + channel) * 2, true) / 32768,
        );
  });
  it("is byte-for-byte deterministic", () => {
    const input = pcm([[0.1, -0.2, 0.3, -0.4]]);
    expect(encodeWav(input)).toEqual(encodeWav(input));
  });
});

describe("invalid input rejection", () => {
  it.each([NaN, Infinity, -Infinity])(
    "rejects non-finite sample %s before export",
    (value) => {
      expect(() => encodeWav(pcm([[value]]))).toThrow("invalid sample");
      expect(() => render(pcm([[value]]), edit(1))).toThrow("invalid sample");
    },
  );
  it("rejects empty and unequal channels", () => {
    expect(() => validatePCM(pcm([[]]))).toThrow();
    expect(() => validatePCM(pcm([[0], [0, 0]]))).toThrow();
    expect(() => validatePCM(pcm([]))).toThrow();
  });
  it("rejects unsupported channel counts and sample rates", () => {
    expect(() => validatePCM(pcm([[0], [0], [0]]))).toThrow();
    for (const rate of [0, 7999, 192001, 44100.5, NaN])
      expect(() => validatePCM(pcm([[0]], rate))).toThrow();
  });
  it("rejects clips exceeding the duration limit", () => {
    expect(() =>
      validatePCM({
        channels: [new Float32Array(8000 * 90 + 1)],
        sampleRate: 8000,
      }),
    ).toThrow("90 seconds");
  });
  it.each([
    { start: -1 },
    { end: 5 },
    { end: 0 },
    { start: 1.5 },
    { end: NaN },
    { fadeIn: NaN },
    { fadeOut: -1 },
    { targetDb: Infinity },
    { targetDb: 1 },
  ])("rejects invalid edit %j", (override) => {
    expect(() => validateEdit(edit(4, override), 4)).toThrow();
  });
});

it("creates a finite deterministic original stereo demo within the input limits", () => {
  const a = demo(),
    b = demo();
  expect(validatePCM(a)).toBe(44100 * 18);
  expect(a.channels.length).toBe(2);
  expect(a.channels[0]).toEqual(b.channels[0]);
  expect(measure(a).peak).toBeLessThan(1);
  expect(measure(a).rms).toBeGreaterThan(0.01);
});
