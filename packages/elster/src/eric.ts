/**
 * Anbindung an die ERiC-Bibliothek (libericapi.so) über koffi.
 * Wird nur im Worker-Prozess geladen: ein Absturz der nativen Bibliothek
 * darf nie den Server-Prozess mitreißen.
 *
 * Achtung: Die Struktur-Versionen und -Layouts unten entsprechen dem
 * ERiC-Entwicklerhandbuch zum Zeitpunkt der Implementierung. Vor dem Einsatz
 * mit der installierten ERiC-Version gegen ericapi.h / ericdef.h abgleichen.
 */
import { parseTransferTicket } from "./ticket.ts";

export const ERIC_OK = 0;
export const ERIC_VALIDIERE = 1 << 1;
export const ERIC_SENDE = 1 << 2;
export const ERIC_DRUCKE = 1 << 5;

/** Version von eric_druck_parameter_t – gegen ericapi.h prüfen. */
export const DRUCK_PARAMETER_VERSION = 2;
/** Version von eric_verschluesselungs_parameter_t – gegen ericapi.h prüfen. */
export const VERSCHLUESSELUNGS_PARAMETER_VERSION = 3;

export interface EricConfig {
  ericHome: string;
  /** Verzeichnis für eric.log; Standard: Systemtemp */
  logDir?: string;
}

export interface EricRequest {
  op: "validate" | "send";
  xml: string;
  datenartVersion: string;
  /** nur bei send */
  certificatePath?: string;
  pin?: string;
  /** Zielpfad für das Übertragungsprotokoll, nur bei send; ohne Pfad kein Druck */
  pdfPath?: string;
}

export interface EricRawResult {
  code: number;
  message: string;
  responseXml: string;
  serverResponseXml: string;
  transferTicket?: string;
}

export function ericLibraryPath(ericHome: string): string {
  return `${ericHome}/lib/libericapi.so`;
}

export function ericPluginPath(ericHome: string): string {
  return `${ericHome}/lib/plugins2`;
}

type Fn = (...args: unknown[]) => unknown;

interface EricApi {
  EricInitialisiere: Fn;
  EricBeende: Fn;
  EricRueckgabepufferErzeugen: Fn;
  EricRueckgabepufferInhalt: Fn;
  EricRueckgabepufferFreigeben: Fn;
  EricHoleFehlerText: Fn;
  EricGetHandleToCertificate: Fn;
  EricCloseHandleToCertificate: Fn;
  EricBearbeiteVorgang: Fn;
}

async function loadEric(libraryPath: string): Promise<EricApi> {
  const { default: koffi } = await import("koffi");
  const lib = koffi.load(libraryPath);

  koffi.opaque("EricRueckgabepuffer");
  koffi.alias("EricRueckgabepufferHandle", "EricRueckgabepuffer *");

  // typedef struct { uint32_t version; uint32_t vorschau; uint32_t ersteSeite;
  //                  uint32_t duplexDruck; const char* pdfName; const char* fussText; }
  koffi.struct("eric_druck_parameter_t", {
    version: "uint32_t",
    vorschau: "uint32_t",
    ersteSeite: "uint32_t",
    duplexDruck: "uint32_t",
    pdfName: "const char *",
    fussText: "const char *",
  });

  // typedef struct { uint32_t version; EricZertifikatHandle zertifikatHandle; const char* pin; }
  koffi.struct("eric_verschluesselungs_parameter_t", {
    version: "uint32_t",
    zertifikatHandle: "uint32_t",
    pin: "const char *",
  });

  return {
    EricInitialisiere: lib.func("int EricInitialisiere(const char *pluginPfad, const char *logPfad)"),
    EricBeende: lib.func("EricBeende", "int", []),
    EricRueckgabepufferErzeugen: lib.func("EricRueckgabepufferErzeugen", "EricRueckgabepufferHandle", []),
    EricRueckgabepufferInhalt: lib.func("const char *EricRueckgabepufferInhalt(EricRueckgabepufferHandle puffer)"),
    EricRueckgabepufferFreigeben: lib.func("int EricRueckgabepufferFreigeben(EricRueckgabepufferHandle puffer)"),
    EricHoleFehlerText: lib.func("int EricHoleFehlerText(int fehlerkode, EricRueckgabepufferHandle puffer)"),
    EricGetHandleToCertificate: lib.func(
      "int EricGetHandleToCertificate(_Out_ uint32_t *hToken, _Out_ uint32_t *iInfoPinSupport, const char *pathToKeystore)",
    ),
    EricCloseHandleToCertificate: lib.func("int EricCloseHandleToCertificate(uint32_t hToken)"),
    EricBearbeiteVorgang: lib.func(
      "int EricBearbeiteVorgang(const char *datenpuffer, const char *datenartVersion, uint32_t bearbeitungsFlags, " +
        "const eric_druck_parameter_t *druckParameter, const eric_verschluesselungs_parameter_t *cryptoParameter, " +
        "_Inout_ uint32_t *transferHandle, EricRueckgabepufferHandle rueckgabeXmlPuffer, " +
        "EricRueckgabepufferHandle serverantwortXmlPuffer)",
    ),
  };
}

/** Ein kompletter Durchlauf: initialisieren, einen Vorgang bearbeiten, beenden. */
export async function runEric(config: EricConfig, request: EricRequest): Promise<EricRawResult> {
  const eric = await loadEric(ericLibraryPath(config.ericHome));
  const logDir = config.logDir ?? (await import("node:os")).tmpdir();

  const initCode = eric.EricInitialisiere(ericPluginPath(config.ericHome), logDir) as number;
  if (initCode !== ERIC_OK) {
    return { code: initCode, message: fehlerText(eric, initCode), responseXml: "", serverResponseXml: "" };
  }

  const rueckgabe = eric.EricRueckgabepufferErzeugen();
  const serverantwort = eric.EricRueckgabepufferErzeugen();
  let zertifikatHandle: number | undefined;
  try {
    let flags = ERIC_VALIDIERE;
    let druck: object | null = null;
    let crypto: object | null = null;

    if (request.op === "send") {
      if (!request.certificatePath || request.pin === undefined) {
        throw new Error("Senden braucht Zertifikat und PIN.");
      }
      const handle = [0];
      const pinSupport = [0];
      const certCode = eric.EricGetHandleToCertificate(handle, pinSupport, request.certificatePath) as number;
      if (certCode !== ERIC_OK) {
        return { code: certCode, message: fehlerText(eric, certCode), responseXml: "", serverResponseXml: "" };
      }
      zertifikatHandle = handle[0];

      flags = ERIC_SENDE | ERIC_VALIDIERE;
      if (request.pdfPath) {
        flags |= ERIC_DRUCKE;
        druck = {
          version: DRUCK_PARAMETER_VERSION,
          vorschau: 0,
          ersteSeite: 0,
          duplexDruck: 0,
          pdfName: request.pdfPath,
          fussText: null,
        };
      }
      crypto = {
        version: VERSCHLUESSELUNGS_PARAMETER_VERSION,
        zertifikatHandle,
        pin: request.pin,
      };
    }

    // Für ElsterAnmeldung (UStVA) kein Transferhandle; Erklärungen, Nachrichten und Datenabholung bekommen einen wie bei viking
    const transferHandle = request.datenartVersion.startsWith("UStVA_") ? null : [0];
    const code = eric.EricBearbeiteVorgang(
      request.xml,
      request.datenartVersion,
      flags,
      druck,
      crypto,
      transferHandle,
      rueckgabe,
      serverantwort,
    ) as number;

    const responseXml = (eric.EricRueckgabepufferInhalt(rueckgabe) as string | null) ?? "";
    const serverResponseXml = (eric.EricRueckgabepufferInhalt(serverantwort) as string | null) ?? "";
    return {
      code,
      message: fehlerText(eric, code),
      responseXml,
      serverResponseXml,
      transferTicket: parseTransferTicket(serverResponseXml),
    };
  } finally {
    if (zertifikatHandle !== undefined) eric.EricCloseHandleToCertificate(zertifikatHandle);
    eric.EricRueckgabepufferFreigeben(rueckgabe);
    eric.EricRueckgabepufferFreigeben(serverantwort);
    eric.EricBeende();
  }
}

function fehlerText(eric: EricApi, code: number): string {
  const puffer = eric.EricRueckgabepufferErzeugen();
  try {
    eric.EricHoleFehlerText(code, puffer);
    return (eric.EricRueckgabepufferInhalt(puffer) as string | null) || `ERiC-Fehler ${code}`;
  } finally {
    eric.EricRueckgabepufferFreigeben(puffer);
  }
}
