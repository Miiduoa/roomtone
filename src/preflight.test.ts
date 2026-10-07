import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { checkDuration } from "./preflight";

let media: {
  duration: number;
  src: string;
  onloadedmetadata: null | (() => void);
  onerror: null | (() => void);
  removeAttribute: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
};
let revoke: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  media = {
    duration: 12,
    src: "",
    onloadedmetadata: null,
    onerror: null,
    removeAttribute: vi.fn(),
    load: vi.fn(),
  };
  vi.stubGlobal(
    "Audio",
    class {
      constructor() {
        return media;
      }
    },
  );
  revoke = vi.fn();
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:test"),
    revokeObjectURL: revoke,
  });
  vi.stubGlobal("window", globalThis);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const file = () => new File(["audio"], "sample.wav", { type: "audio/wav" });

it("accepts bounded duration and releases its media URL", async () => {
  const promise = checkDuration(file(), new AbortController().signal);
  media.onloadedmetadata!();
  await promise;
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:test");
  expect(media.onloadedmetadata).toBeNull();
  expect(media.removeAttribute).toHaveBeenCalledWith("src");
});
it("rejects a long recording before decode and cleans up", async () => {
  media.duration = 3600;
  const promise = checkDuration(file(), new AbortController().signal);
  const check = expect(promise).rejects.toThrow("bounds");
  media.onloadedmetadata!();
  await check;
  expect(revoke).toHaveBeenCalledOnce();
});
it.each([NaN, Infinity, 0])(
  "rejects unreadable duration %s",
  async (duration) => {
    media.duration = duration;
    const promise = checkDuration(file(), new AbortController().signal);
    const check = expect(promise).rejects.toThrow("metadata");
    media.onloadedmetadata!();
    await check;
  },
);
it("cancels stale metadata reads and releases their URL exactly once", async () => {
  const controller = new AbortController();
  const promise = checkDuration(file(), controller.signal);
  const check = expect(promise).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await check;
  vi.advanceTimersByTime(11_000);
  expect(revoke).toHaveBeenCalledOnce();
  expect(media.onerror).toBeNull();
});
it("times out unreadable media rather than leaving the desk loading", async () => {
  const promise = checkDuration(file(), new AbortController().signal);
  const check = expect(promise).rejects.toThrow("metadata");
  vi.advanceTimersByTime(10_000);
  await check;
  expect(revoke).toHaveBeenCalledOnce();
});
it("cleans up when the media element rejects the file", async () => {
  const promise = checkDuration(file(), new AbortController().signal);
  const check = expect(promise).rejects.toThrow("metadata");
  media.onerror!();
  await check;
  expect(revoke).toHaveBeenCalledOnce();
});
