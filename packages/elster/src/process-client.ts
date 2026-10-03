import { fork } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EricConfig, EricRawResult, EricRequest } from "./eric.ts";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";
import { buildVastAnfrageXml, VAST_DATENART_VERSION, type VastXmlInput } from "./vast.ts";
import { failure, type BelegabrufResult, type ElsterClient, type ElsterResult, type PostfachOptions, type PostfachResult, type SendOptions } from "./types.ts";
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
    return (await this.#run({ op: "validate", xml, datenartVersion })).result;
  }

  async send(xml: string, certificate: Uint8Array, pin: string, options: SendOptions): Promise<ElsterResult> {
    const datenartVersion = datenartVersionFromXml(xml);
    if (!datenartVersion) return failure("Datenart-Version im XML nicht gefunden.");
    const mismatch = testmerkerMismatch(xml, options.test);
    if (mismatch) return failure(mismatch);

    return this.#withCertificate(certificate, async (dir, certificatePath) => {
      const pdfPath = options.print === false ? undefined : join(dir, "protokoll.pdf");
      const { result } = await this.#run({ op: "send", xml, datenartVersion, certificatePath, pin, ...(pdfPath ? { pdfPath } : {}) });
      const pdf = pdfPath ? await readFile(pdfPath).catch(() => undefined) : undefined;
      return pdf ? { ...result, pdf: new Uint8Array(pdf) } : result;
    });
  }

  async fetchPostfach(xml: string, certificate: Uint8Array, pin: string, options: PostfachOptions): Promise<PostfachResult> {
    const leer = { bereitstellungen: [], dateien: [] };
    const datenartVersion = datenartVersionFromXml(xml);
    if (datenartVersion !== "PostfachAnfrage_31") return { ...failure("Keine PostfachAnfrage (Version 31)."), ...leer };
    const mismatch = testmerkerMismatch(xml, options.test);
    if (mismatch) return { ...failure(mismatch), ...leer };

    return this.#withCertificate(certificate, async (_dir, certificatePath) => {
      const { result, raw } = await this.#run({ op: "postfach", xml, datenartVersion, certificatePath, pin, herstellerId: options.herstellerId });
      const postfach = raw?.postfach;
      return {
        ...result,
        bereitstellungen: postfach?.bereitstellungen ?? [],
        dateien: (postfach?.dateien ?? []).map((datei) => ({
          referenzId: datei.referenzId,
          ...(datei.base64 !== undefined ? { inhalt: new Uint8Array(Buffer.from(datei.base64, "base64")) } : {}),
          ...(datei.fehler !== undefined ? { fehler: datei.fehler } : {}),
        })),
      };
    });
  }

  async fetchBelege(input: VastXmlInput, certificate: Uint8Array, pin: string): Promise<BelegabrufResult> {
    let requestXml: string;
    try {
      requestXml = buildVastAnfrageXml(input);
    } catch (error) {
      return { ...failure(error instanceof Error ? error.message : String(error)), requestXml: "", liste: [], belege: [] };
    }
    return this.#withCertificate(certificate, async (_dir, certificatePath) => {
      const { result, raw } = await this.#run({ op: "vast", xml: requestXml, datenartVersion: VAST_DATENART_VERSION, certificatePath, pin, vast: input });
      const vast = raw?.vast;
      const abholung = vast?.abholung;
      // Scheitert die Abholung, zählt der ganze Abruf als gescheitert
      const failed = abholung && abholung.code !== 0;
      return {
        ...result,
        ...(failed ? { ok: false, code: abholung.code, message: abholung.message } : {}),
        requestXml,
        liste: vast?.liste ?? [],
        ...(abholung
          ? { abholung: { requestXml: abholung.requestXml, responseXml: abholung.responseXml, serverResponseXml: abholung.serverResponseXml } }
          : {}),
        belege: vast?.belege ?? [],
      };
    });
  }

  /** Legt das Zertifikat in einem eigenen Temp-Verzeichnis ab (mkdtemp: 0700) und räumt danach auf. */
  async #withCertificate<T>(certificate: Uint8Array, run: (dir: string, certificatePath: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), "haben-eric-"));
    try {
      const certificatePath = join(dir, "zertifikat.pfx");
      await writeFile(certificatePath, certificate, { mode: 0o600, flag: "wx" });
      return await run(dir, certificatePath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async #run(request: EricRequest): Promise<{ result: ElsterResult; raw?: EricRawResult }> {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, workerPath = DEFAULT_WORKER_PATH, execArgv } = this.#options;
    const config: EricConfig = { ericHome: this.#options.ericHome, logDir: this.#options.logDir };

    return new Promise<{ result: ElsterResult; raw?: EricRawResult }>((resolve) => {
      let response: WorkerResponse | undefined;
      let settled = false;
      let stderr = "";

      const finish = (result: ElsterResult, raw?: EricRawResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(raw ? { result, raw } : { result });
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
        if (response?.type === "result") return finish(toElsterResult(response.result), response.result);
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

function testmerkerMismatch(xml: string, test: boolean): string | undefined {
  if (hasTestmerker(xml) === test) return undefined;
  return test
    ? "Testübermittlung angefordert, aber das XML trägt keinen Testmerker."
    : "Echte Übermittlung angefordert, aber das XML trägt einen Testmerker.";
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
