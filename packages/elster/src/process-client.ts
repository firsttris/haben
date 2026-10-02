import { fork } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EricConfig, EricRawResult, EricRequest } from "./eric.ts";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";
import { failure, type ElsterClient, type ElsterResult, type SendOptions } from "./types.ts";
import { datenartVersionFromXml, hasTestmerker } from "./xml.ts";

export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_WORKER_PATH = fileURLToPath(new URL("./worker.ts", import.meta.url));
/** Node 22 braucht für .ts-Dateien (je nach Minor-Version) noch das Flag. */
export const DEFAULT_WORKER_EXEC_ARGV = ["--experimental-strip-types", "--disable-warning=ExperimentalWarning"];

export interface EricProcessClientOptions extends EricConfig {
  timeoutMs?: number;
  /** Austauschbar für Tests */
  workerPath?: string;
  execArgv?: string[];
}

/** Führt jeden ERiC-Aufruf in einem eigenen, kurzlebigen Kindprozess aus. */
export class EricProcessClient implements ElsterClient {
  readonly #options: EricProcessClientOptions;

  constructor(options: EricProcessClientOptions) {
    this.#options = options;
  }

  async validate(xml: string): Promise<ElsterResult> {
    const datenartVersion = datenartVersionFromXml(xml);
    if (!datenartVersion) return failure("Datenart-Version im XML nicht gefunden.");
    return this.#run({ op: "validate", xml, datenartVersion });
  }

  async send(xml: string, certificate: Uint8Array, pin: string, options: SendOptions): Promise<ElsterResult> {
    const datenartVersion = datenartVersionFromXml(xml);
    if (!datenartVersion) return failure("Datenart-Version im XML nicht gefunden.");
    if (hasTestmerker(xml) !== options.test) {
      return failure(
        options.test
          ? "Testübermittlung angefordert, aber das XML trägt keinen Testmerker."
          : "Echte Übermittlung angefordert, aber das XML trägt einen Testmerker.",
      );
    }

    // mkdtemp legt das Verzeichnis mit 0700 an.
    const dir = await mkdtemp(join(tmpdir(), "haben-eric-"));
    try {
      const certificatePath = join(dir, "zertifikat.pfx");
      const pdfPath = join(dir, "protokoll.pdf");
      await writeFile(certificatePath, certificate, { mode: 0o600, flag: "wx" });
      const result = await this.#run({ op: "send", xml, datenartVersion, certificatePath, pin, pdfPath });
      const pdf = await readFile(pdfPath).catch(() => undefined);
      return pdf ? { ...result, pdf: new Uint8Array(pdf) } : result;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  #run(request: EricRequest): Promise<ElsterResult> {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, workerPath = DEFAULT_WORKER_PATH, execArgv } = this.#options;
    const config: EricConfig = { ericHome: this.#options.ericHome, logDir: this.#options.logDir };

    return new Promise((resolve) => {
      let response: WorkerResponse | undefined;
      let settled = false;
      let stderr = "";

      const finish = (result: ElsterResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const child = fork(workerPath, [], {
        execArgv: execArgv ?? DEFAULT_WORKER_EXEC_ARGV,
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        serialization: "json",
      });

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(failure(`ERiC-Prozess nach ${Math.round(timeoutMs / 1000)} s abgebrochen (Zeitüberschreitung).`));
      }, timeoutMs);

      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(-2000);
      });
      child.on("message", (message: WorkerResponse) => {
        response = message;
      });
      child.on("error", (error) => {
        child.kill("SIGKILL");
        finish(failure(`ERiC-Prozess konnte nicht gestartet werden: ${error.message}`));
      });
      child.on("close", (code, signal) => {
        if (response?.type === "result") return finish(toElsterResult(response.result));
        if (response?.type === "error") return finish(failure(response.message));
        const grund = signal ? `Signal ${signal}` : `Exit-Code ${code}`;
        const detail = stderr.trim() ? `: ${stderr.trim().split("\n").slice(-3).join(" ")}` : "";
        finish(failure(`ERiC-Prozess abgestürzt (${grund})${detail}`));
      });

      const message: WorkerRequest = { type: "request", config, request };
      child.send(message, (error) => {
        if (error) {
          child.kill("SIGKILL");
          finish(failure(`Anfrage an ERiC-Prozess fehlgeschlagen: ${error.message}`));
        }
      });
    });
  }
}

function toElsterResult(raw: EricRawResult): ElsterResult {
  return {
    ok: raw.code === 0,
    code: raw.code,
    message: raw.message,
    responseXml: raw.responseXml,
    serverResponseXml: raw.serverResponseXml,
    ...(raw.transferTicket ? { transferTicket: raw.transferTicket } : {}),
  };
}
