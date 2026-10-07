/// <reference lib="webworker" />
import { render, validatePCM } from "./audio";
import type { Edit, PCM } from "./audio";
let source: PCM | undefined;
let revision = 0;
self.onmessage = (
  event: MessageEvent<{
    type: "load" | "render" | "clear";
    pcm?: PCM;
    edit?: Edit;
    id: number;
    revision: number;
  }>,
) => {
  const message = event.data;
  try {
    if (message.type === "clear") {
      source = undefined;
      revision = message.revision;
    } else if (message.type === "load" && message.pcm) {
      validatePCM(message.pcm);
      source = message.pcm;
      revision = message.revision;
    } else if (
      message.type === "render" &&
      message.edit &&
      source &&
      revision === message.revision
    ) {
      const result = render(source, message.edit);
      self.postMessage(
        { type: "result", id: message.id, revision, ...result },
        { transfer: result.pcm.channels.map((channel) => channel.buffer) },
      );
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      id: message.id,
      revision: message.revision,
      message:
        error instanceof Error ? error.message : "Audio processing failed.",
    });
  }
};
