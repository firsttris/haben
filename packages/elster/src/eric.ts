/**
 * Anbindung an die ERiC-Bibliothek (libericapi.so) über koffi.
 * Wird nur im Worker-Prozess geladen: ein Absturz der nativen Bibliothek
 * darf nie den Server-Prozess mitreißen.
 *
 * Struktur-Versionen und -Layouts entsprechen eric_types.h und ericapi.h aus ERiC 43
 * (eric_druck_parameter_t Version 4, eric_verschluesselungs_parameter_t Version 3).
 */
import { parsePostfachAntwort, type PostfachBereitstellung } from "./postfach.ts";
import { parseTransferTicket } from "./ticket.ts";

export const ERIC_OK = 0;
export const ERIC_VALIDIERE = 1 << 1;
export const ERIC_SENDE = 1 << 2;
export const ERIC_DRUCKE = 1 << 5;

/** Version von eric_druck_parameter_t laut eric_types.h (ERiC 43) */
export const DRUCK_PARAMETER_VERSION = 4;
/** Version von eric_verschluesselungs_parameter_t laut eric_types.h (ERiC 43) */
export const VERSCHLUESSELUNGS_PARAMETER_VERSION = 3;

export interface EricConfig {
  ericHome: string;
  /** Verzeichnis für eric.log; Standard: Systemtemp */
  logDir?: string;
}

export interface EricRequest {
  /** postfach: PostfachAnfrage senden und die Anhänge über Otto herunterladen (ohne Bestätigung) */
  op: "validate" | "send" | "postfach";
  xml: string;
  datenartVersion: string;
  /** nur bei send */
  certificatePath?: string;
  pin?: string;
  /** Zielpfad für das Übertragungsprotokoll, nur bei send; ohne Pfad kein Druck */
  pdfPath?: string;
  /** nur bei postfach: für den Download über Otto */
  herstellerId?: string;
}

/** Ein heruntergeladener Anhang; Inhalt base64, weil er per IPC als JSON reist */
export interface PostfachDatei {
  referenzId: string;
  base64?: string;
  fehler?: string;
}

export interface EricRawResult {
  code: number;
  message: string;
  responseXml: string;
  serverResponseXml: string;
  transferTicket?: string;
  postfach?: { bereitstellungen: PostfachBereitstellung[]; dateien: PostfachDatei[] };
}

export function ericLibraryPath(ericHome: string): string {
  return `${ericHome}/lib/libericapi.so`;
}

export function ottoLibraryPath(ericHome: string): string {
  return `${ericHome}/lib/libotto.so`;
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

  // typedef struct { uint32_t version; uint32_t vorschau; uint32_t duplexDruck; const char* pdfName;
  //                  const char* fussText; EricPdfCallback pdfCallback; void* pdfCallbackBenutzerdaten; }
  koffi.struct("eric_druck_parameter_t", {
    version: "uint32_t",
    vorschau: "uint32_t",
    duplexDruck: "uint32_t",
    pdfName: "const char *",
    fussText: "const char *",
    pdfCallback: "void *",
    pdfCallbackBenutzerdaten: "void *",
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

    if (request.op === "send" || request.op === "postfach") {
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
          duplexDruck: 0,
          pdfName: request.pdfPath,
          fussText: null,
          pdfCallback: null,
          pdfCallbackBenutzerdaten: null,
        };
      }
      crypto = {
        version: VERSCHLUESSELUNGS_PARAMETER_VERSION,
        zertifikatHandle,
        pin: request.pin,
      };
    }

    // Laut ericapi.h nur bei der Datenabholung (Postfach) ein Transferhandle, sonst immer NULL
    const transferHandle = request.datenartVersion.startsWith("Postfach") ? [0] : null;
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
    const result: EricRawResult = {
      code,
      message: fehlerText(eric, code),
      responseXml,
      serverResponseXml,
      transferTicket: parseTransferTicket(serverResponseXml),
    };
    if (request.op === "postfach" && code === ERIC_OK) {
      const bereitstellungen = parsePostfachAntwort(serverResponseXml);
      const anhaenge = bereitstellungen.flatMap((b) => b.anhaenge);
      const dateien =
        anhaenge.length === 0
          ? []
          : await downloadOtto(config, logDir, anhaenge, request.certificatePath!, request.pin!, request.herstellerId ?? "");
      result.postfach = { bereitstellungen, dateien };
    }
    return result;
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

/** Lädt die Anhänge über Otto vom OTTER-Server; Fehler je Datei, damit der Rest trotzdem ankommt. */
async function downloadOtto(
  config: EricConfig,
  logDir: string,
  anhaenge: { referenzId: string; groesse: number }[],
  certificatePath: string,
  pin: string,
  herstellerId: string,
): Promise<PostfachDatei[]> {
  const { default: koffi } = await import("koffi");
  const lib = koffi.load(ottoLibraryPath(config.ericHome));
  koffi.opaque("OttoInstanz");
  koffi.opaque("OttoRueckgabepuffer");
  const InstanzErzeugen = lib.func(
    "int OttoInstanzErzeugen(const char *logPfad, void *logCallback, void *logCallbackBenutzerdaten, _Out_ OttoInstanz **instanz)",
  );
  const InstanzFreigeben = lib.func("int OttoInstanzFreigeben(OttoInstanz *instanz)");
  const PufferErzeugen = lib.func("int OttoRueckgabepufferErzeugen(OttoInstanz *instanz, _Out_ OttoRueckgabepuffer **puffer)");
  const PufferInhalt = lib.func("const void *OttoRueckgabepufferInhalt(OttoRueckgabepuffer *puffer)");
  const PufferGroesse = lib.func("uint64_t OttoRueckgabepufferGroesse(OttoRueckgabepuffer *puffer)");
  const PufferFreigeben = lib.func("int OttoRueckgabepufferFreigeben(OttoRueckgabepuffer *puffer)");
  const DatenAbholen = lib.func(
    "int OttoDatenAbholen(OttoInstanz *instanz, const char *objektId, uint32_t objektGroesse, const char *zertifikatsPfad, " +
      "const char *zertifikatsPasswort, const char *herstellerId, const char *abholzertifikat, OttoRueckgabepuffer *abholDaten)",
  );
  const HoleFehlertext = lib.func("const char *OttoHoleFehlertext(int statuscode)");
  const ottoFehler = (code: number) => `Otto-Fehler ${code}: ${(HoleFehlertext(code) as string | null) ?? "unbekannt"}`;

  const instanz: unknown[] = [null];
  const instanzCode = InstanzErzeugen(logDir, null, null, instanz) as number;
  if (instanzCode !== 0) return anhaenge.map((a) => ({ referenzId: a.referenzId, fehler: ottoFehler(instanzCode) }));
  try {
    const dateien: PostfachDatei[] = [];
    for (const anhang of anhaenge) {
      const puffer: unknown[] = [null];
      const pufferCode = PufferErzeugen(instanz[0], puffer) as number;
      if (pufferCode !== 0) {
        dateien.push({ referenzId: anhang.referenzId, fehler: ottoFehler(pufferCode) });
        continue;
      }
      try {
        const code = DatenAbholen(instanz[0], anhang.referenzId, anhang.groesse, certificatePath, pin, herstellerId, null, puffer[0]) as number;
        if (code !== 0) {
          dateien.push({ referenzId: anhang.referenzId, fehler: ottoFehler(code) });
          continue;
        }
        const groesse = Number(PufferGroesse(puffer[0]));
        const inhalt = PufferInhalt(puffer[0]);
        if (!inhalt || groesse === 0) {
          dateien.push({ referenzId: anhang.referenzId, fehler: "Leere Datei abgeholt." });
          continue;
        }
        const bytes = Buffer.from(koffi.view(inhalt, groesse)).toString("base64");
        dateien.push({ referenzId: anhang.referenzId, base64: bytes });
      } finally {
        PufferFreigeben(puffer[0]);
      }
    }
    return dateien;
  } finally {
    InstanzFreigeben(instanz[0]);
  }
}
