import { MAX_SECONDS } from "./audio";

/** Check normal media duration before allocating decoded PCM. Decoding itself is not cancellable. */
export function checkDuration(file: File, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const media = new Audio();
    const url = URL.createObjectURL(file);
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      media.onloadedmetadata = null;
      media.onerror = null;
      media.removeAttribute("src");
      media.load();
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else resolve();
    };
    const abort = () =>
      finish(new DOMException("Superseded import", "AbortError"));
    const timer = window.setTimeout(
      () => finish(new Error("metadata")),
      10_000,
    );
    signal.addEventListener("abort", abort, { once: true });
    media.preload = "metadata";
    media.onloadedmetadata = () => {
      if (!Number.isFinite(media.duration) || media.duration <= 0)
        finish(new Error("metadata"));
      else if (media.duration > MAX_SECONDS) finish(new Error("bounds"));
      else finish();
    };
    media.onerror = () => finish(new Error("metadata"));
    if (signal.aborted) {
      abort();
      return;
    }
    media.src = url;
  });
}
