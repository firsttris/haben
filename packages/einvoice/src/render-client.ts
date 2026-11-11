import { type ChildProcess, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RenderedSheet, RenderJob, RenderRequest, RenderResponse } from "./render-protocol.ts";
import { PACKAGE_DIR } from "./typst-compiler.ts";

export const RENDER_TIMEOUT_MS = 5_000;
export const RENDER_IDLE_MS = 5 * 60_000;
const WORKER_PATH = join(PACKAGE_DIR, "src", "render-worker.ts");
/** Port 9 („discard“) auf dem eigenen Rechner: Typst scheitert beim Paketabruf sofort, statt zu warten */
const DEAD_PROXY = "http://127.0.0.1:9";

/**
 * Umgebung des Render-Prozesses: Nichts aus der App (Datenbank, Schlüssel) wird vererbt, das Netz ist über einen toten
 * Proxy gesperrt, und HOME zeigt ins Leere, damit Typst keinen Paket-Cache des Rechners findet.
 */
export function renderWorkerEnv(cacheDir?: string): Record<string, string> {
  const home = cacheDir ?? join(tmpdir(), "haben-render-ohne-home");
  return {
    PATH: process.env.PATH ?? "",
    HABEN_EINVOICE_DIR: PACKAGE_DIR,
    // Typst sucht Pakete unter dem Cache des Nutzers: unter Linux XDG_CACHE_HOME, unter macOS HOME/Library/Caches
    HOME: home,
    XDG_CACHE_HOME: home,
    XDG_DATA_HOME: home,
    ...Object.fromEntries(["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"].map((name) => [name, DEAD_PROXY])),
  };
}

/** Wo Typst Pakete aus @preview ablegt, wenn HOME und XDG_CACHE_HOME auf cacheDir zeigen */
export const packageCacheRoot = (cacheDir: string): string =>
  process.platform === "darwin" ? join(cacheDir, "Library", "Caches", "typst", "packages") : join(cacheDir, "typst", "packages");

type Result = { sheet: RenderedSheet } | { pdf: string };

interface Pending {
  job: RenderJob;
  resolve: (result: Result) => void;
  reject: (error: Error) => void;
}

export interface RenderClientOptions {
  timeoutMs?: number;
  idleMs?: number;
  /** Austauschbar für Tests */
  workerPath?: string;
  /** Eigener Paket-Cache, etwa eines Layouts mit freigegebenen Paketen; ohne gibt es keine Pakete */
  cacheDir?: string;
}

export interface RenderClient {
  render: (job: RenderJob) => Promise<RenderedSheet>;
  /** Dasselbe als PDF/A-3b, etwa beim Festschreiben mit einem eigenen Layout */
  renderPdf: (job: RenderJob, date: string) => Promise<Uint8Array>;
  close: () => void;
}

/**
 * Hält einen Render-Prozess warm und gibt ihm die Aufträge nacheinander. Überschreitet einer das Zeitlimit, wird der
 * Prozess hart beendet und für den nächsten neu gestartet; ohne Aufträge endet er nach idleMs von selbst.
 */
export function createRenderClient({
  timeoutMs = RENDER_TIMEOUT_MS,
  idleMs = RENDER_IDLE_MS,
  workerPath = WORKER_PATH,
  cacheDir,
}: RenderClientOptions = {}): RenderClient {
  const queue: Pending[] = [];
  let child: ChildProcess | undefined;
  let running: (Pending & { id: number; timer: NodeJS.Timeout }) | undefined;
  let idleTimer: NodeJS.Timeout | undefined;
  let nextId = 1;

  const stop = () => {
    child?.kill("SIGKILL");
    child = undefined;
  };

  const finish = (settle: (pending: Pending) => void) => {
    if (!running) return;
    const done = running;
    running = undefined;
    clearTimeout(done.timer);
    settle(done);
    next();
  };

  const onMessage = (response: RenderResponse) => {
    if (response.id !== running?.id) return;
    finish((pending) => (response.ok ? pending.resolve(response) : pending.reject(new Error(response.message))));
  };

  const start = (): ChildProcess => {
    // Ohne Core-Dump: Der eines abgestürzten Bun-Prozesses ist mehrere GB groß (wie beim ERiC-Worker)
    const started = spawn("/bin/sh", ["-c", 'ulimit -c 0 && exec "$@"', "sh", process.execPath, workerPath], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      serialization: "json",
      env: renderWorkerEnv(cacheDir),
      cwd: tmpdir(),
    });
    started.on("message", (message) => onMessage(message as RenderResponse));
    const gone = () => {
      if (child !== started) return;
      child = undefined;
      finish((pending) => pending.reject(new Error("Der Render-Prozess wurde unerwartet beendet.")));
    };
    started.on("exit", gone);
    started.on("error", gone);
    return started;
  };

  function next() {
    if (running) return;
    const pending = queue.shift();
    if (!pending) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(stop, idleMs);
      idleTimer.unref();
      return;
    }
    clearTimeout(idleTimer);
    child ??= start();
    const id = nextId++;
    const timer = setTimeout(() => {
      stop();
      finish((p) => p.reject(new Error(`Das Rendern hat das Zeitlimit von ${timeoutMs / 1000} Sekunden überschritten.`)));
    }, timeoutMs);
    running = { ...pending, id, timer };
    const request: RenderRequest = { ...pending.job, id };
    child.send(request);
  }

  const enqueue = (job: RenderJob) =>
    new Promise<Result>((resolve, reject) => {
      queue.push({ job, resolve, reject });
      next();
    });

  return {
    render: (job) => enqueue(job).then((result) => ("sheet" in result ? result.sheet : Promise.reject(new Error("Kein SVG")))),
    renderPdf: (job, date) =>
      enqueue({ ...job, pdf: { date } }).then((result) =>
        "pdf" in result ? new Uint8Array(Buffer.from(result.pdf, "base64")) : Promise.reject(new Error("Kein PDF")),
      ),
    close: () => {
      clearTimeout(idleTimer);
      stop();
    },
  };
}
