import { afterEach, expect, it, vi } from "vitest";
import type { Edit, PCM } from "./audio";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("drops stale renders after source replacement and clear, and processes the current source", async () => {
  const postMessage = vi.fn();
  const workerScope = { onmessage: (_event: MessageEvent) => {}, postMessage };
  vi.stubGlobal("self", workerScope);
  await import("./audio.worker");
  const edit: Edit = {
    start: 0,
    end: 2,
    fadeIn: 0,
    fadeOut: 0,
    normalize: false,
    targetDb: -1,
  };
  const source = (value: number): PCM => ({
    sampleRate: 8000,
    channels: [new Float32Array([value, value])],
  });
  const send = (data: object) =>
    workerScope.onmessage({ data } as MessageEvent);
  send({ type: "load", pcm: source(0.25), revision: 1, id: 1 });
  send({ type: "load", pcm: source(0.5), revision: 2, id: 2 });
  send({ type: "render", edit, revision: 1, id: 1 });
  expect(postMessage).not.toHaveBeenCalled();
  send({ type: "render", edit, revision: 2, id: 2 });
  expect(postMessage.mock.calls[0][0].pcm.channels[0][0]).toBe(0.5);
  expect(postMessage.mock.calls[0][0]).toMatchObject({
    id: 2,
    revision: 2,
    type: "result",
  });
  postMessage.mockClear();
  send({ type: "clear", revision: 3, id: 3 });
  send({ type: "render", edit, revision: 2, id: 2 });
  send({ type: "render", edit, revision: 3, id: 3 });
  expect(postMessage).not.toHaveBeenCalled();
});

it("returns a tagged error for invalid edits instead of a corrupt buffer", async () => {
  const postMessage = vi.fn(),
    workerScope = { onmessage: (_event: MessageEvent) => {}, postMessage };
  vi.stubGlobal("self", workerScope);
  await import("./audio.worker");
  workerScope.onmessage({
    data: {
      type: "load",
      pcm: { sampleRate: 8000, channels: [new Float32Array([1])] },
      revision: 4,
      id: 7,
    },
  } as MessageEvent);
  workerScope.onmessage({
    data: {
      type: "render",
      edit: {
        start: 0,
        end: 2,
        fadeIn: 0,
        fadeOut: 0,
        normalize: false,
        targetDb: -1,
      },
      revision: 4,
      id: 8,
    },
  } as MessageEvent);
  expect(postMessage.mock.calls[0][0]).toMatchObject({
    type: "error",
    revision: 4,
    id: 8,
  });
});
