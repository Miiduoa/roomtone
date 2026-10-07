import "./style.css";
import {
  db,
  demo,
  encodeWav,
  MAX_FILE_BYTES,
  quantize,
  validatePCM,
} from "./audio";
import type { Edit, PCM, Rendered } from "./audio";
import { copy } from "./i18n";
import type { CopyKey, Language } from "./i18n";
import { checkDuration } from "./preflight";

let language: Language = "zh";
try {
  if (localStorage.getItem("roomtone-language") === "en") language = "en";
} catch {
  /* Storage is optional. */
}
const t = (key: CopyKey): string => copy[language][key];
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const icon = (
  name: "play" | "stop" | "upload" | "download" | "help" | "close" | "lock",
) =>
  ({
    play: '<path d="m9 5 11 7-11 7z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
    upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
    download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.4 8.6a2.7 2.7 0 0 1 5.2 1c0 2-2.6 2-2.6 4m0 3v.2"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  })[name];
const svg = (name: Parameters<typeof icon>[0]) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${icon(name)}</svg>`;
let source: PCM | null = null;
let fileName = "";
let isDemo = true;
let edit: Edit = {
  start: 0,
  end: 1,
  fadeIn: 0.08,
  fadeOut: 0.65,
  normalize: false,
  targetDb: -1,
};
let processed: Rendered | null = null;
let revision = 0,
  requestId = 0,
  importId = 0,
  playId = 0;
let loading = false,
  processing = false,
  mode: "source" | "processed" = "processed";
let statusKey: CopyKey = "ready",
  statusError = false;
let context: AudioContext | null = null;
let player: AudioBufferSourceNode | null = null;
let playbackStart = 0,
  animation = 0,
  renderTimer = 0;
let peaks: { min: number; max: number }[][] = [];
let observer: ResizeObserver | null = null;
let importController: AbortController | null = null;
const worker = new Worker(new URL("./audio.worker.ts", import.meta.url), {
  type: "module",
});

function status(key: CopyKey, error = false) {
  statusKey = key;
  statusError = error;
  el("status").textContent = t(key);
  el("status").classList.toggle("error", error);
}

function mount() {
  document.documentElement.lang = copy[language].locale;
  document.title =
    language === "zh"
      ? "Roomtone — 一張小小的聲音工作桌"
      : "Roomtone — a small audio desk";
  el("app").innerHTML = `
    <div class="page">
      <header class="masthead">
        <a class="wordmark" href="${import.meta.env.BASE_URL}" aria-label="Roomtone"><span class="mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>roomtone<span class="wordmark-dot">.</span></a>
        <div class="head-right"><span class="local-indicator"><span></span>${t("local")}</span><button id="language" class="text-button" aria-label="${t("languageLabel")}">${t("language")}</button><button id="help" class="icon-button" aria-label="${t("help")}">${svg("help")}</button></div>
      </header>
      <main>
        <section class="intro" aria-labelledby="title"><div><p class="eyebrow"><span class="tiny-line"></span>${t("desk")}</p><h1 id="title">${t("title")}</h1><p class="intro-copy">${t("subtitle")}</p></div><div class="edition" aria-hidden="true"><span>RT—01</span><span>${t("steps")}</span></div></section>
        <section id="desk" class="desk" aria-label="${t("desk")}">
          <div class="source-bar"><div class="track-ident"><div class="record-icon" aria-hidden="true"><span></span></div><div class="track-detail"><div class="track-title"><h2 id="filename"></h2><span id="demo-tag" class="tag">${t("demoTag")}</span></div><p id="filemeta"></p></div></div><div class="file-actions"><button id="demo" class="quiet-button">${t("demo")}</button><button id="open" class="open-button">${svg("upload")}${t("import")}</button><input type="file" id="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac,.aiff,.aif" hidden /></div></div>
          <div class="wave-area"><div id="ruler" class="ruler" aria-hidden="true"></div><div class="wave-wrap" id="wave-wrap"><canvas id="wave" aria-label="${t("timeline")}" role="img"></canvas><div id="empty" class="empty-wave"><p>${t("emptyName")}</p><span>${t("emptyHelp")}</span></div><button id="start-handle" class="trim-handle start" role="slider" aria-label="${t("handleStart")}" aria-orientation="horizontal" aria-describedby="trim-hint"><span>Ⅰ</span></button><button id="end-handle" class="trim-handle end" role="slider" aria-label="${t("handleEnd")}" aria-orientation="horizontal" aria-describedby="trim-hint"><span>Ⅱ</span></button><div class="channel-labels" id="channel-labels" aria-hidden="true"></div></div><div class="wave-caption"><span id="selection-label"></span><button id="whole" class="dark-text-button">${t("whole")} ↗</button></div></div>
          <div class="transport"><div class="transport-left"><button id="play" class="play-button" aria-label="${t("play")}">${svg("play")}</button><output id="clock" class="clock">00:00<span>.000</span></output><span class="transport-slash">/</span><span id="duration" class="duration"></span><span class="keyboard-hint">${t("space")}</span></div><div class="ab" role="group" aria-label="${t("ab")}"><button id="source-mode" aria-pressed="false">${t("source")}</button><button id="processed-mode" aria-pressed="true">${t("result")}</button></div></div>
          <div class="edit-grid">
            <section class="edit-section"><div class="section-title"><span>01</span><h3>${t("trimTitle")}</h3></div><p class="section-help">${t("trimHelp")}</p><div class="time-fields"><label>${t("start")}<span class="number-unit"><input id="start" type="number" min="0" step="any" inputmode="decimal" aria-describedby="trim-hint"/><span>s</span></span></label><span class="time-arrow" aria-hidden="true">→</span><label>${t("end")}<span class="number-unit"><input id="end" type="number" min="0" step="any" inputmode="decimal" aria-describedby="trim-hint"/><span>s</span></span></label></div><p class="fine-print" id="trim-hint">${t("trimHint")}</p></section>
            <section class="edit-section"><div class="section-title"><span>02</span><h3>${t("fadeTitle")}</h3></div><div class="fade-control"><label for="fade-in">${t("fadeIn")}</label><span class="fade-shape in" aria-hidden="true"></span><span class="small-number"><input id="fade-in" type="number" min="0" step=".01" inputmode="decimal"/><span>s</span></span><input id="fade-in-range" type="range" min="0" step=".01" aria-label="${t("fadeIn")}"/></div><div class="fade-control"><label for="fade-out">${t("fadeOut")}</label><span class="fade-shape out" aria-hidden="true"></span><span class="small-number"><input id="fade-out" type="number" min="0" step=".01" inputmode="decimal"/><span>s</span></span><input id="fade-out-range" type="range" min="0" step=".01" aria-label="${t("fadeOut")}"/></div><p class="fine-print">${t("fadeHelp")}</p></section>
            <section class="edit-section"><div class="section-title"><span>03</span><h3>${t("levelTitle")}</h3></div><label class="toggle-label" for="normalize"><span>${t("normalize")}</span><input id="normalize" type="checkbox" role="switch"/><span class="toggle" aria-hidden="true"></span></label><div class="target-row"><label for="target">${t("target")}</label><span class="small-number"><input id="target" type="number" min="-24" max="0" step=".1"/><span>dBFS</span></span></div><p class="fine-print">${t("normalizeHelp")}<br/><span id="gain"></span></p></section>
          </div>
          <div class="finish-bar"><div class="meters"><div><span>${t("peak")}</span><strong id="peak">—</strong><small>dBFS</small></div><div><span>${t("rms")}</span><strong id="rms">—</strong><small>dBFS</small></div><p>${t("metricHelp")}</p></div><div class="export-side"><div><p id="export-meta"></p><span>${t("exportHint")}</span></div><button id="export" class="export-button">${svg("download")}${t("export")}</button></div></div>
        </section>
        <div class="below-desk"><p id="status" role="status" aria-live="polite"></p><div><button id="reset" class="text-button">${t("reset")}</button><span aria-hidden="true">/</span><button id="clear" class="text-button">${t("clear")}</button></div></div><p id="clip-warning" class="clip-warning" role="status" hidden></p>
        <section class="notes"><div>${svg("lock")}<div><h3>${t("noUploadTitle")}</h3><p>${t("noUpload")}</p></div></div><div><span class="note-symbol" aria-hidden="true">∿</span><div><h3>${t("formatsTitle")}</h3><p>${t("formats")}</p></div></div></section>
      </main><footer><span>ROOMTONE <span class="footer-dot">•</span> BY MIIDUOA</span><span>${t("built")}</span><span>EST. 2026</span></footer>
    </div><div id="drop-overlay" class="drop-overlay" hidden><p>${t("drop")}</p></div>
    <dialog id="help-dialog" aria-labelledby="help-title"><button id="close-help" class="icon-button" aria-label="${t("close")}">${svg("close")}</button><span class="eyebrow">ROOMTONE / ${t("help")}</span><h2 id="help-title">${t("helpTitle")}</h2><p>${t("helpText")}</p><p>${t("helpAudio")}</p><p class="fine-print">${t("trimHint")}</p></dialog>`;
  bind();
  update();
  status(statusKey, statusError);
  observer?.disconnect();
  observer = new ResizeObserver(() => draw());
  observer.observe(el("wave-wrap"));
}

function formatTime(seconds: number, precise = false): string {
  const total = Math.max(0, Math.floor(seconds * 1000));
  const mins = Math.floor(total / 60000)
    .toString()
    .padStart(2, "0");
  const secs = Math.floor((total / 1000) % 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}${precise ? `.${(total % 1000).toString().padStart(3, "0")}` : ""}`;
}
function numberValue(id: string, value: number) {
  if (document.activeElement !== el(id))
    el<HTMLInputElement>(id).value = String(Number(value.toFixed(6)));
}
function update() {
  const frames = source?.channels[0].length ?? 1,
    rate = source?.sampleRate ?? 44100;
  const duration = (edit.end - edit.start) / rate;
  el("filename").textContent = source
    ? isDemo
      ? t("demoName")
      : fileName
    : t("emptyName");
  el("demo-tag").hidden = !source || !isDemo;
  el("filemeta").textContent = source
    ? `${source.channels.length === 1 ? t("mono") : t("stereo")} · ${(rate / 1000).toLocaleString(language === "zh" ? "zh-TW" : "en-US")} kHz ${t("workingRate")} · ${formatTime(frames / rate, true)}`
    : t("disabledHint");
  el("empty").hidden = !!source;
  el("channel-labels").innerHTML = source
    ? source.channels.length === 1
      ? "<span>M</span>"
      : "<span>L</span><span>R</span>"
    : "";
  el("ruler").innerHTML = Array.from(
    { length: 7 },
    (_, i) =>
      `<span>${frames / rate < 10 ? formatTime(((frames / rate) * i) / 6, true).slice(0, -1) : formatTime(((frames / rate) * i) / 6)}</span>`,
  ).join("");
  el("selection-label").textContent = source
    ? `${t("selection")}  ${formatTime(edit.start / rate, true)} — ${formatTime(edit.end / rate, true)}  ·  ${(edit.end - edit.start).toLocaleString()} ${t("frames")}`
    : t("disabledHint");
  el("duration").textContent = source
    ? formatTime(duration, true)
    : "00:00.000";
  if (!player) el("clock").innerHTML = "00:00<span>.000</span>";
  for (const [id, value] of [
    ["start", edit.start / rate],
    ["end", edit.end / rate],
    ["fade-in", edit.fadeIn],
    ["fade-out", edit.fadeOut],
    ["fade-in-range", edit.fadeIn],
    ["fade-out-range", edit.fadeOut],
    ["target", edit.targetDb],
  ] as const)
    numberValue(id, value);
  el<HTMLInputElement>("start").max = String(Math.max(0, edit.end - 1) / rate);
  el<HTMLInputElement>("end").max = String(frames / rate);
  el<HTMLInputElement>("end").min = String((edit.start + 1) / rate);
  for (const id of ["fade-in", "fade-out", "fade-in-range", "fade-out-range"])
    el<HTMLInputElement>(id).max = String(duration);
  el<HTMLInputElement>("normalize").checked = edit.normalize;
  const disabled = !source || loading;
  for (const id of [
    "play",
    "export",
    "whole",
    "reset",
    "clear",
    "start",
    "end",
    "fade-in",
    "fade-out",
    "fade-in-range",
    "fade-out-range",
    "target",
    "normalize",
    "source-mode",
    "processed-mode",
    "start-handle",
    "end-handle",
  ])
    (el(id) as HTMLButtonElement | HTMLInputElement).disabled = disabled;
  el<HTMLInputElement>("target").disabled = disabled || !edit.normalize;
  el<HTMLButtonElement>("play").disabled = disabled || processing || !processed;
  el<HTMLButtonElement>("export").disabled =
    disabled || processing || !processed;
  el("desk").setAttribute("aria-busy", String(loading || processing));
  el("source-mode").setAttribute("aria-pressed", String(mode === "source"));
  el("processed-mode").setAttribute(
    "aria-pressed",
    String(mode === "processed"),
  );
  for (const [id, frame, min, max] of [
    ["start-handle", edit.start, 0, edit.end - 1],
    ["end-handle", edit.end, edit.start + 1, frames],
  ] as const) {
    const handle = el(id);
    handle.hidden = !source;
    handle.style.left = `${(frame / frames) * 100}%`;
    handle.setAttribute("aria-valuemin", String(min));
    handle.setAttribute("aria-valuemax", String(max));
    handle.setAttribute("aria-valuenow", String(frame));
    handle.setAttribute(
      "aria-valuetext",
      `${(frame / rate).toFixed(6)} ${t("seconds")}, ${frame} ${t("frames")}`,
    );
  }
  el("peak").textContent =
    processed && !processing ? db(processed.metrics.peak) : "—";
  el("rms").textContent =
    processed && !processing ? db(processed.metrics.rms) : "—";
  el("gain").textContent =
    processed && !processing
      ? `${t("gain")}: ${processed.gain === 1 ? t("untouched") : `${db(processed.gain)} dB`}`
      : `${t("gain")}: —`;
  el("export-meta").textContent = source
    ? `${duration.toFixed(3)} s · ${((44 + (edit.end - edit.start) * source.channels.length * 2) / 1024 / 1024).toFixed(2)} MB`
    : t("exportTitle");
  const clipped = processed?.metrics.clippedSamples ?? 0;
  el("clip-warning").hidden = !clipped || processing;
  el("clip-warning").textContent =
    `${clipped.toLocaleString()} ${t("clipWarning")}`;
  updatePlay();
  draw();
}

function updatePlay() {
  el("play").innerHTML = svg(player ? "stop" : "play");
  el("play").setAttribute("aria-label", t(player ? "stop" : "play"));
  el("play").classList.toggle("playing", !!player);
}
function makePeaks(pcm: PCM) {
  const bins = Math.min(1800, pcm.channels[0].length);
  return pcm.channels.map((channel) =>
    Array.from({ length: bins }, (_, bin) => {
      let min = 0,
        max = 0;
      for (
        let i = Math.floor((bin * channel.length) / bins);
        i < Math.floor(((bin + 1) * channel.length) / bins);
        i++
      ) {
        min = Math.min(min, channel[i]);
        max = Math.max(max, channel[i]);
      }
      return { min, max };
    }),
  );
}
function draw() {
  const canvas = el<HTMLCanvasElement>("wave");
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect(),
    dpr = Math.min(devicePixelRatio || 1, 2);
  if (
    canvas.width !== Math.round(rect.width * dpr) ||
    canvas.height !== Math.round(rect.height * dpr)
  ) {
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx || !rect.width) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  const width = rect.width,
    height = rect.height;
  ctx.strokeStyle = "#43453e";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += width / 24) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  if (!source) return;
  const frames = source.channels[0].length;
  const startX = (edit.start / frames) * width,
    endX = (edit.end / frames) * width;
  ctx.fillStyle = "#e69a7012";
  ctx.fillRect(startX, 0, endX - startX, height);
  const channelHeight = height / peaks.length;
  peaks.forEach((channel, index) => {
    const center = (index + 0.5) * channelHeight,
      amp = channelHeight * 0.4;
    ctx.strokeStyle = "#68695e";
    ctx.beginPath();
    ctx.moveTo(0, center);
    ctx.lineTo(width, center);
    ctx.stroke();
    channel.forEach((value, bin) => {
      const x = (bin / channel.length) * width;
      ctx.strokeStyle = x >= startX && x <= endX ? "#e7a282" : "#797d70";
      ctx.lineWidth = Math.max(1, width / channel.length);
      ctx.beginPath();
      ctx.moveTo(x, center - Math.min(1, value.max) * amp);
      ctx.lineTo(x, center - Math.max(-1, value.min) * amp);
      ctx.stroke();
    });
  });
  const fadeInX = Math.min(
    endX,
    startX + ((edit.fadeIn * source.sampleRate) / frames) * width,
  );
  const fadeOutX = Math.max(
    startX,
    endX - ((edit.fadeOut * source.sampleRate) / frames) * width,
  );
  ctx.strokeStyle = "#efbe89";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(startX, height - 10);
  ctx.lineTo(fadeInX, 10);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(fadeOutX, 10);
  ctx.lineTo(endX, height - 10);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = "#e7a282";
  ctx.strokeRect(startX + 0.5, 0.5, Math.max(0, endX - startX - 1), height - 1);
  if (player && context) {
    const elapsed = Math.min(
      (edit.end - edit.start) / source.sampleRate,
      context.currentTime - playbackStart,
    );
    const x = ((edit.start + elapsed * source.sampleRate) / frames) * width;
    ctx.strokeStyle = "#f9eee1";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
}

function stop() {
  playId++;
  cancelAnimationFrame(animation);
  if (player) {
    player.onended = null;
    try {
      player.stop();
    } catch {
      /* Already ended. */
    }
    player.disconnect();
    player = null;
  }
  if (el("play")) {
    updatePlay();
    el("clock").innerHTML = "00:00<span>.000</span>";
    draw();
  }
}
function audioContext(): AudioContext {
  if (!("AudioContext" in window)) throw new Error("browser");
  if (!context || context.state === "closed") context = new AudioContext();
  return context;
}
async function play() {
  if (player) {
    stop();
    return;
  }
  if (!source || !processed || processing || loading) return;
  const ticket = ++playId,
    expectedRequest = requestId,
    expectedRevision = revision;
  try {
    const ctx = audioContext();
    await ctx.resume();
    if (
      ticket !== playId ||
      expectedRequest !== requestId ||
      expectedRevision !== revision ||
      !source ||
      !processed ||
      loading ||
      processing
    )
      return;
    const pcm =
      mode === "processed"
        ? quantize(processed.pcm)
        : {
            channels: source.channels.map((channel) =>
              channel.slice(edit.start, edit.end),
            ),
            sampleRate: source.sampleRate,
          };
    const buffer = ctx.createBuffer(
      pcm.channels.length,
      pcm.channels[0].length,
      pcm.sampleRate,
    );
    pcm.channels.forEach((channel, index) =>
      buffer.copyToChannel(new Float32Array(channel), index),
    );
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);
    player = node;
    node.onended = () => {
      if (player === node) {
        node.disconnect();
        player = null;
        cancelAnimationFrame(animation);
        updatePlay();
        draw();
      }
    };
    playbackStart = ctx.currentTime;
    node.start();
    updatePlay();
    const tick = () => {
      if (!player) return;
      const value = formatTime(
        Math.min(
          (edit.end - edit.start) / pcm.sampleRate,
          ctx.currentTime - playbackStart,
        ),
        true,
      );
      const [time, fraction] = value.split(".");
      el("clock").innerHTML = `${time}<span>.${fraction}</span>`;
      draw();
      animation = requestAnimationFrame(tick);
    };
    tick();
  } catch (error) {
    stop();
    status(
      error instanceof Error && error.message === "browser"
        ? "browserError"
        : "audioError",
      true,
    );
  }
}

function scheduleRender() {
  stop();
  requestId++;
  processed = null;
  processing = !!source;
  clearTimeout(renderTimer);
  if (!source) {
    update();
    return;
  }
  status("processing");
  update();
  const id = requestId,
    rev = revision,
    snapshot = { ...edit };
  renderTimer = window.setTimeout(
    () =>
      worker.postMessage({ type: "render", edit: snapshot, revision: rev, id }),
    75,
  );
}
worker.onmessage = (
  event: MessageEvent<
    Rendered & { type: "result" | "error"; id: number; revision: number }
  >,
) => {
  if (event.data.id !== requestId || event.data.revision !== revision) return;
  processing = false;
  if (event.data.type === "error") {
    processed = null;
    status("workerError", true);
  } else {
    processed = event.data;
    if (!loading)
      status(
        isDemo && edit.start === 0 && edit.end === source?.channels[0].length
          ? "ready"
          : "prepared",
      );
  }
  update();
};
worker.onerror = () => {
  processing = false;
  processed = null;
  update();
  status("workerError", true);
};

function setSource(pcm: PCM, name: string, demoClip: boolean) {
  validatePCM(pcm);
  stop();
  source = pcm;
  fileName = name;
  isDemo = demoClip;
  revision++;
  loading = false;
  edit = {
    start: 0,
    end: pcm.channels[0].length,
    fadeIn: Math.min(0.08, pcm.channels[0].length / pcm.sampleRate),
    fadeOut: Math.min(0.65, pcm.channels[0].length / pcm.sampleRate),
    normalize: false,
    targetDb: -1,
  };
  peaks = makePeaks(pcm);
  const workerPCM: PCM = {
    sampleRate: pcm.sampleRate,
    channels: pcm.channels.map((channel) => channel.slice()),
  };
  worker.postMessage(
    { type: "load", pcm: workerPCM, revision, id: requestId + 1 },
    workerPCM.channels.map((channel) => channel.buffer),
  );
  scheduleRender();
}
async function importFile(file: File) {
  const token = ++importId;
  stop();
  importController?.abort();
  importController = new AbortController();
  if (file.size > MAX_FILE_BYTES) {
    loading = false;
    update();
    status("fileLarge", true);
    return;
  }
  if (!file.size) {
    loading = false;
    update();
    status("unsupported", true);
    return;
  }
  loading = true;
  status("importing");
  update();
  try {
    await checkDuration(file, importController.signal);
    if (token !== importId) return;
    const ctx = audioContext();
    const data = await file.arrayBuffer();
    if (token !== importId) return;
    const buffer = await ctx.decodeAudioData(data);
    if (token !== importId) return;
    const pcm: PCM = {
      sampleRate: buffer.sampleRate,
      channels: Array.from({ length: buffer.numberOfChannels }, (_, i) =>
        buffer.getChannelData(i),
      ),
    };
    try {
      validatePCM(pcm);
    } catch {
      throw new Error("bounds");
    }
    setSource(pcm, file.name, false);
    status("loaded");
  } catch (error) {
    if (token !== importId) return;
    loading = false;
    update();
    status(
      error instanceof Error && error.message === "browser"
        ? "browserError"
        : error instanceof Error && error.message === "bounds"
          ? "invalid"
          : error instanceof Error && error.message === "metadata"
            ? "metadataError"
            : "unsupported",
      true,
    );
  }
}
function changeSelection(start: number, end: number) {
  if (!source || loading) return;
  const length = source.channels[0].length;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end > length ||
    start >= end
  ) {
    status("invalidEdit", true);
    restoreTimeInputs();
    update();
    return;
  }
  edit.start = Math.round(start);
  edit.end = Math.round(end);
  const duration = (edit.end - edit.start) / source.sampleRate;
  edit.fadeIn = Math.min(edit.fadeIn, duration);
  edit.fadeOut = Math.min(edit.fadeOut, duration);
  restoreTimeInputs();
  scheduleRender();
}
function restoreTimeInputs() {
  if (!source) return;
  for (const side of ["start", "end"] as const)
    el<HTMLInputElement>(side).value = String(
      Number((edit[side] / source.sampleRate).toFixed(6)),
    );
}
function download() {
  if (!processed || processing || loading || !source) return;
  try {
    const wav = encodeWav(processed.pcm);
    const blob = new Blob([wav], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${
      isDemo
        ? "roomtone-afternoon"
        : fileName
            .replace(/\.[^.]+$/, "")
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
            .slice(0, 100) || "roomtone"
    }-edit.wav`;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    status("exported");
  } catch {
    status("downloadFailure", true);
  }
}

function bindHandle(id: string, which: "start" | "end") {
  const handle = el(id);
  handle.addEventListener("keydown", (event) => {
    if (!source || loading) return;
    const length = source.channels[0].length,
      step = event.shiftKey ? Math.round(source.sampleRate / 10) : 1;
    let value = edit[which];
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") value -= step;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp")
      value += step;
    else if (event.key === "Home")
      value = which === "start" ? 0 : edit.start + 1;
    else if (event.key === "End")
      value = which === "start" ? edit.end - 1 : length;
    else return;
    event.preventDefault();
    value =
      which === "start"
        ? Math.max(0, Math.min(edit.end - 1, value))
        : Math.max(edit.start + 1, Math.min(length, value));
    changeSelection(
      which === "start" ? value : edit.start,
      which === "end" ? value : edit.end,
    );
  });
  handle.addEventListener("pointerdown", (event) => {
    if (!source || loading) return;
    event.preventDefault();
    handle.focus();
    handle.setPointerCapture(event.pointerId);
    const move = (movement: PointerEvent) => {
      if (!source) return;
      const rect = el("wave-wrap").getBoundingClientRect(),
        length = source.channels[0].length;
      let value = Math.round(
        ((movement.clientX - rect.left) / rect.width) * length,
      );
      value =
        which === "start"
          ? Math.max(0, Math.min(edit.end - 1, value))
          : Math.max(edit.start + 1, Math.min(length, value));
      changeSelection(
        which === "start" ? value : edit.start,
        which === "end" ? value : edit.end,
      );
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  });
}
function bind() {
  el("language").onclick = () => {
    stop();
    language = language === "zh" ? "en" : "zh";
    try {
      localStorage.setItem("roomtone-language", language);
    } catch {
      /* Optional preference. */
    }
    mount();
  };
  el("help").onclick = () => el<HTMLDialogElement>("help-dialog").showModal();
  el("close-help").onclick = () => el<HTMLDialogElement>("help-dialog").close();
  el<HTMLDialogElement>("help-dialog").onclick = (event) => {
    if (event.target === el("help-dialog")) {
      const rect = el("help-dialog").getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        el<HTMLDialogElement>("help-dialog").close();
    }
  };
  el("open").onclick = () => el<HTMLInputElement>("file").click();
  el<HTMLInputElement>("file").onchange = (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file) void importFile(file);
  };
  el("demo").onclick = () => {
    importId++;
    importController?.abort();
    setSource(demo(), "roomtone-afternoon", true);
  };
  el("play").onclick = () => {
    void play();
  };
  el("export").onclick = download;
  for (const version of ["source", "processed"] as const)
    el(`${version}-mode`).onclick = () => {
      stop();
      mode = version;
      update();
    };
  for (const side of ["start", "end"] as const)
    el<HTMLInputElement>(side).onchange = () => {
      if (!source) return;
      const value = el<HTMLInputElement>(side).valueAsNumber;
      if (!Number.isFinite(value)) {
        status("invalidEdit", true);
        restoreTimeInputs();
        return;
      }
      changeSelection(
        side === "start" ? Math.round(value * source.sampleRate) : edit.start,
        side === "end" ? Math.round(value * source.sampleRate) : edit.end,
      );
    };
  for (const [prefix, key] of [
    ["fade-in", "fadeIn"],
    ["fade-out", "fadeOut"],
  ] as const)
    for (const suffix of ["", "-range"]) {
      const input = el<HTMLInputElement>(prefix + suffix);
      const change = () => {
        if (!source) return;
        const value = input.valueAsNumber;
        if (
          !Number.isFinite(value) ||
          value < 0 ||
          value > (edit.end - edit.start) / source.sampleRate
        ) {
          status("invalidFade", true);
          input.value = String(edit[key]);
          return;
        }
        edit[key] = value;
        scheduleRender();
      };
      if (suffix) input.oninput = change;
      else input.onchange = change;
    }
  el<HTMLInputElement>("normalize").onchange = () => {
    edit.normalize = el<HTMLInputElement>("normalize").checked;
    scheduleRender();
  };
  el<HTMLInputElement>("target").onchange = () => {
    const value = el<HTMLInputElement>("target").valueAsNumber;
    if (!Number.isFinite(value) || value < -24 || value > 0) {
      status("invalidTarget", true);
      el<HTMLInputElement>("target").value = String(edit.targetDb);
      return;
    }
    edit.targetDb = value;
    scheduleRender();
  };
  el("whole").onclick = () => {
    if (source) changeSelection(0, source.channels[0].length);
  };
  el("reset").onclick = () => {
    if (source) {
      edit = {
        start: 0,
        end: source.channels[0].length,
        fadeIn: 0,
        fadeOut: 0,
        normalize: false,
        targetDb: -1,
      };
      scheduleRender();
    }
  };
  el("clear").onclick = () => {
    importId++;
    importController?.abort();
    revision++;
    requestId++;
    stop();
    clearTimeout(renderTimer);
    worker.postMessage({ type: "clear", revision, id: requestId });
    source = null;
    processed = null;
    processing = false;
    loading = false;
    peaks = [];
    edit = {
      start: 0,
      end: 1,
      fadeIn: 0,
      fadeOut: 0,
      normalize: false,
      targetDb: -1,
    };
    update();
    status("emptyStatus");
  };
  bindHandle("start-handle", "start");
  bindHandle("end-handle", "end");
}

let dragDepth = 0;
document.addEventListener("dragenter", (event) => {
  if (event.dataTransfer?.types.includes("Files")) {
    event.preventDefault();
    dragDepth++;
    el("drop-overlay").hidden = false;
  }
});
document.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes("Files")) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }
});
document.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) el("drop-overlay").hidden = true;
});
document.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  el("drop-overlay").hidden = true;
  const files = event.dataTransfer?.files;
  if (files?.length === 1) void importFile(files[0]);
  else status("noFiles", true);
});
document.addEventListener("keydown", (event) => {
  if (
    event.code !== "Space" ||
    event.repeat ||
    (event.target instanceof Element &&
      event.target.closest("input, button, a, dialog, [contenteditable]"))
  )
    return;
  event.preventDefault();
  void play();
});
window.addEventListener("pagehide", () => {
  stop();
  void context?.suspend();
});
mount();
setSource(demo(), "roomtone-afternoon", true);
