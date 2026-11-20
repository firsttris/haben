import { createServer, type Server } from "node:http";
import { Message, type Segment } from "lib-fints";
import { fintsDay } from "./map.ts";

/**
 * Nachgebaute FinTS-Bank für Tests (nur über `@haben/import/fints-testbank`, nicht im Paket): ein HTTP-Server, der
 * Nachrichten von lib-fints liest und mit echten FinTS-Segmenten antwortet. Er kennt Dialogaufbau mit BPD, UPD und
 * Kundensystem-ID, zwei TAN-Verfahren (pushTAN entkoppelt, chipTAN mit TAN), starke Kundenauthentifizierung bei der
 * Anmeldung oder beim Umsatzabruf (je einmal, wie die Ausnahme nach Art. 10 der Delegierten Verordnung (EU) 2018/389, heute
 * 180 Tage) und Umsätze als MT940 (HKKAZ), auf Wunsch so, dass lib-fints sie nicht lesen kann.
 * Die Freigabe in der App meldet sie wie echte Banken mit 3955 („Sicherheitsfreigabe erfolgt über anderen Kanal“), solange
 * sie aussteht mit 3956. Auf Wunsch verhält sie sich wie die Consorsbank: eine eingetippte TAN bei der Anmeldung mit
 * pushTAN, der Umsatzabruf laut HIPINS ohne TAN, ohne HKTAN aber mit 9075 abgelehnt.
 * Segmente nach FinTS 3.0 (Formals, PIN/TAN), Rückmeldungscodes nach der Liste „FinTS Rückmeldungscodes“ der DK (Stand
 * 03.02.2026); nur 9952 steht nicht darin, so lehnte eine echte Bank beim ersten Test ab (Speicherstadt/haben#1289).
 */

export interface FintsTestbankUmsatz {
  /** YYYY-MM-DD */
  tag: string;
  /** Betrag mit Komma, negativ für Abgänge: "100,00", "-49,99" */
  betrag: string;
  name: string;
  iban?: string;
  zweck: string;
  ref: string;
}

export interface FintsTestbankKonto {
  iban: string;
  nummer: string;
  name: string;
  waehrung?: string;
}

export interface FintsTestbankOptionen {
  produktId: string;
  blz?: string;
  bankname?: string;
  benutzer?: string;
  pin?: string;
  tan?: string;
  konten?: FintsTestbankKonto[];
  umsaetze?: Record<string, FintsTestbankUmsatz[]>;
  port?: number;
}

export interface FintsTestbankAnfrage {
  segmente: string[];
  produktId?: string;
  pin?: string;
  tan?: string;
  /** TAN-Prozess aus HKTAN: 4 beim Auftrag, 2 mit TAN, S als Statusabfrage bei der Freigabe in der App */
  tanProzess?: string;
  /** Sicherheitsfunktion aus HNSHK: 999 ohne Verfahren, sonst das gewählte TAN-Verfahren */
  verfahren?: number;
  iban?: string;
  von?: string;
  bis?: string;
}

export interface FintsTestbank {
  url: string;
  zustand: {
    /** Die nächste Anmeldung mit TAN-Verfahren verlangt eine TAN */
    scaBeiAnmeldung: boolean;
    /** Der nächste Umsatzabruf verlangt eine TAN */
    scaBeiUmsaetzen: boolean;
    /** pushTAN: In der App freigegeben */
    freigegeben: boolean;
    /**
     * pushTAN wie die Consorsbank mit ihrer App (Speicherstadt/haben#654, python-fints#218): Die Anmeldung verlangt eine TAN aus
     * der App zum Eintippen (0030 ohne 3955), obwohl die BPD das Verfahren als entkoppelt führen; eine Statusabfrage dazu
     * (HKTAN Prozess S) lehnt sie mit 9010 ab und bricht den Dialog ab (9800)
     */
    appTanEintippen: boolean;
    /**
     * Wie die Consorsbank (Speicherstadt/haben#654, python-fints#218): HIPINS führt den Umsatzabruf ohne TAN (HKKAZ:N), einen
     * Abruf ohne HKTAN lehnt sie aber mit 9075 ab. Gilt für die BPD der nächsten ersten Synchronisierung.
     */
    umsatzTanVerschwiegen: boolean;
    /** Antwortet mit HTTP 503 */
    nichtErreichbar: boolean;
    /** HKKAZ: :61: ohne Kundenreferenz, die SWIFT MT940 verlangt (sonst NONREF); lib-fints kann das MT940 dann nicht lesen */
    mt940Unlesbar: boolean;
    anfragen: FintsTestbankAnfrage[];
  };
  schliessen(): Promise<void>;
}

const PUSH = 921;
const CHIPTAN = 912;

/** Sonderzeichen in Textfeldern maskieren (FinTS: ? vor + : ' ? @) */
const esc = (text: string) => text.replace(/[?+:'@]/g, (c) => `?${c}`);

type Seg = Segment & Record<string, unknown>;

function feld<T>(segmente: Seg[], id: string): (Seg & T) | undefined {
  return segmente.find((s) => s.header.segId === id) as (Seg & T) | undefined;
}

function betragMt940(cents: number): string {
  const abs = Math.abs(cents);
  return `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

const yymmdd = (tag: string) => tag.slice(2).replace(/-/g, "");

/** Cent aus "1.234,56" oder "-49,99", ohne Gleitkomma */
function cents(betrag: string): number {
  const negativ = betrag.trim().startsWith("-");
  const [ganz = "0", rest = ""] = betrag.replace(/[-.\s]/g, "").split(",");
  const wert = Number(ganz) * 100 + Number(rest.padEnd(2, "0").slice(0, 2));
  return negativ ? -wert : wert;
}

function mt940(blz: string, konto: FintsTestbankKonto, umsaetze: FintsTestbankUmsatz[], von: string, bis: string, unlesbar: boolean): string {
  const vorher = umsaetze.filter((u) => u.tag < von).reduce((s, u) => s + cents(u.betrag), 0);
  const imZeitraum = umsaetze.filter((u) => u.tag >= von && u.tag <= bis).sort((a, b) => a.tag.localeCompare(b.tag));
  const nachher = vorher + imZeitraum.reduce((s, u) => s + cents(u.betrag), 0);
  const cd = (c: number) => (c < 0 ? "D" : "C");
  const zeilen = [":20:STARTUMSE", `:25:${blz}/${konto.nummer}`, ":28C:00000/001", `:60F:${cd(vorher)}${yymmdd(von)}EUR${betragMt940(vorher)}`];
  for (const u of imZeitraum) {
    const c = cents(u.betrag);
    const zweck = `SVWZ+${u.zweck}`;
    const teile = zweck.match(/.{1,27}/g) ?? [];
    const felder = teile.map((t, i) => `?${20 + i}${t}`).join("");
    zeilen.push(`:61:${yymmdd(u.tag)}${u.tag.slice(5).replace("-", "")}${cd(c)}R${betragMt940(c)}NTRF${unlesbar ? "" : "NONREF"}//${u.ref}`);
    zeilen.push(`:86:166?00${c < 0 ? "SEPA-UEBERWEISUNG" : "SEPA-GUTSCHRIFT"}${felder}${u.iban ? `?31${u.iban}` : ""}?32${u.name.slice(0, 27)}`);
  }
  zeilen.push(`:62F:${cd(nachher)}${yymmdd(bis)}EUR${betragMt940(nachher)}`, "-");
  return zeilen.join("\r\n");
}

/** Antwortnachricht ohne Verschlüsselung; lib-fints liest beides */
function nachricht(dialogId: string, msgNr: number, segmente: string[]): string {
  const rumpf = segmente.map((s, i) => s.replace("{n}", String(i + 2)));
  const ende = `HNHBS:${rumpf.length + 2}:1+${msgNr}`;
  const kopf = (laenge: number) => `HNHBK:1:3+${String(laenge).padStart(12, "0")}+300+${dialogId}+${msgNr}+${dialogId}:${msgNr}`;
  const ohneKopf = [...rumpf, ende].map((s) => `${s}'`).join("");
  const laenge = kopf(0).length + 1 + Buffer.byteLength(ohneKopf, "latin1");
  return `${kopf(laenge)}'${ohneKopf}`;
}

/** Zustand der nachgebauten Bank über alle Dialoge */
interface Bank {
  blz: string;
  benutzer: string;
  pin: string;
  tan: string;
  optionen: FintsTestbankOptionen;
  konten: FintsTestbankKonto[];
  zustand: FintsTestbank["zustand"];
  /** Aufträge, die auf TAN oder Freigabe warten, nach Auftragsreferenz; eintippen: TAN verlangt, keine Freigabe in der App */
  offen: Map<string, { art: "HKIDN" | "HKKAZ"; eintippen?: boolean; iban?: string; von?: string; bis?: string }>;
  zaehler: number;
}

type Antwort = { dialogId: string; segmente: string[] };

const OK = "HIRMG:{n}:2+0010::Nachricht entgegengenommen.";
const ref = (s: Seg | undefined) => s?.header.segNr ?? 0;

/** BPD: Bank, TAN-Verfahren (pushTAN entkoppelt, chipTAN mit TAN), PIN/TAN-Geschäftsvorfälle und HKKAZ */
const bpd = (bank: Bank, r: number) => [
  `HIBPA:{n}:3:${r}+1+280:${bank.blz}+${esc(bank.optionen.bankname ?? "Testbank")}+1+1+300`,
  `HITANS:{n}:7:${r}+1+1+0+J:N:0:${PUSH}:2:pushTAN2.0:Decoupled::pushTAN 2.0:::Freigabe:2048:N:2:N:0:0:N:N:00:0:N:1:60:1:1:J:J:${CHIPTAN}:2:HHD1.3.0:HHD:1.3.0:chipTAN manuell:6:1:TAN-Nummer:2048:N:2:N:0:0:N:N:00:0:N:1`,
  `HIPINS:{n}:1:${r}+1+1+0+5:20:6:Anmeldename:Kunden-ID:HKKAZ:${bank.zustand.umsatzTanVerschwiegen ? "N" : "J"}:HKSAL:N:HKTAN:N:HKIDN:J:HKTAB:N`,
  `HIKAZS:{n}:7:${r}+1+1+0+90:N:N`,
];

const upd = (bank: Bank, r: number) => [
  `HIUPA:{n}:4:${r}+${esc(bank.benutzer)}+1+0`,
  ...bank.konten.map(
    (k) =>
      `HIUPD:{n}:6:${r}+${k.nummer}::280:${bank.blz}+${k.iban}+${esc(bank.benutzer)}+1+${k.waehrung ?? "EUR"}+Max Mustermann++${esc(k.name)}++HKKAZ:1+HKSAL:1`,
  ),
];

function umsatzAntwort(bank: Bank, r: number, iban = "", von = "2000-01-01", bis = "2099-12-31"): string[] {
  const konto = bank.konten.find((k) => k.iban === iban);
  if (!konto) return [`HIRMS:{n}:2:${r}+9210::Konto unbekannt.`];
  const daten = mt940(bank.blz, konto, bank.optionen.umsaetze?.[iban] ?? [], von, bis, bank.zustand.mt940Unlesbar);
  return [`HIRMS:{n}:2:${r}+0020::Der Auftrag wurde ausgeführt.`, `HIKAZ:{n}:7:${r}+@${Buffer.byteLength(daten, "latin1")}@${daten}`];
}

/**
 * Wie die Bank eine Freigabe verlangt: tan mit TAN (0030), app in der App (0030 und 3955, wie die Consorsbank bei einer
 * Überweisung), ausstehend solange die Freigabe in der App fehlt (3956), appTan mit TAN aus der App wie die Consorsbank bei
 * der Anmeldung (0030 ohne 3955, ihr Text)
 */
type Freigabe = "tan" | "app" | "ausstehend" | "appTan";

const ERFORDERLICH = "0030::Auftrag empfangen - Sicherheitsfreigabe erforderlich.";
const RUECKMELDUNG: Record<Freigabe, string> = {
  tan: ERFORDERLICH,
  app: `${ERFORDERLICH}+3955::Sicherheitsfreigabe erfolgt über anderen Kanal.`,
  ausstehend: "3956::Starke Kundenauthentifizierung noch ausstehend.",
  appTan: ERFORDERLICH,
};
const CHALLENGE: Record<Freigabe, string> = {
  tan: "Bitte geben Sie die TAN ein.",
  app: "Bitte bestätigen Sie den Zugriff in Ihrer Banking-App.",
  ausstehend: "Bitte bestätigen Sie den Zugriff in Ihrer Banking-App.",
  appTan: "Bitte generieren Sie eine TAN mit Ihrer Banking App oder Ihrem TAN Generator und geben diese hier ein.",
};

const tanAnfrage = (r: number, referenz: string, freigabe: Freigabe) => [
  `HIRMS:{n}:2:${r}+${RUECKMELDUNG[freigabe]}`,
  `HITAN:{n}:7:${r}+4++${referenz}+${CHALLENGE[freigabe]}`,
];

/** Dialogaufbau (HKIDN, HKVVB, HKSYN, HKTAN): ohne TAN-Verfahren nur BPD, mit Verfahren je nach SCA TAN oder UPD */
function anmeldung(bank: Bank, segmente: Seg[], anfrage: FintsTestbankAnfrage, dialogId: string): Antwort {
  const vvb = feld<{ bpdVersion: number }>(segmente, "HKVVB");
  const syn = feld(segmente, "HKSYN");
  const hktan = feld(segmente, "HKTAN");
  const verfahren = anfrage.verfahren ?? 999;
  const antwort = [OK, `HIRMS:{n}:2:${ref(vvb)}+3920::Zugelassene Zwei-Schritt-Verfahren für den Benutzer.:${PUSH}:${CHIPTAN}+0020::Dialog initialisiert.`];
  if (!vvb || vvb.bpdVersion < 1) antwort.push(...bpd(bank, ref(vvb)));
  if (syn) antwort.push(`HISYN:{n}:4:${ref(syn)}+SYS${bank.zaehler}`);
  if (verfahren === 999 || !hktan) return { dialogId, segmente: antwort };
  if (bank.zustand.scaBeiAnmeldung) {
    const referenz = `REF${bank.zaehler}`;
    const eintippen = verfahren !== PUSH || bank.zustand.appTanEintippen;
    bank.offen.set(referenz, { art: "HKIDN", eintippen });
    const freigabe = verfahren !== PUSH ? "tan" : eintippen ? "appTan" : "app";
    return { dialogId, segmente: [...antwort, ...tanAnfrage(ref(hktan), referenz, freigabe)] };
  }
  return { dialogId, segmente: [...antwort, `HIRMS:{n}:2:${ref(hktan)}+3076::Starke Kundenauthentifizierung nicht notwendig.`, ...upd(bank, ref(vvb))] };
}

/** HKTAN Prozess 2 (TAN) oder S (Status bei pushTAN) zu einem wartenden Auftrag */
function tanFortsetzung(bank: Bank, hktan: Seg & { tanProcess: string; orderRef?: string }, anfrage: FintsTestbankAnfrage, dialogId: string): Antwort {
  const auftrag = bank.offen.get(hktan.orderRef ?? "");
  if (!auftrag) return { dialogId, segmente: ["HIRMG:{n}:2+9050::Teilweise fehlerhaft.", `HIRMS:{n}:2:${ref(hktan)}+9210::Auftragsreferenz unbekannt.`] };
  if (hktan.tanProcess === "S" && auftrag.eintippen) {
    // Statt der verlangten TAN nur eine Statusabfrage: so antwortete die Consorsbank (Speicherstadt/haben#654)
    bank.offen.delete(hktan.orderRef!);
    return {
      dialogId,
      segmente: [
        "HIRMG:{n}:2+9800::Der Dialog wurde abgebrochen. Bitte melden Sie sich erneut an.",
        `HIRMS:{n}:2:${ref(hktan)}+9010::Verarbeitung nicht möglich.`,
      ],
    };
  }
  if (hktan.tanProcess === "S" && !bank.zustand.freigegeben) {
    return { dialogId, segmente: [OK, ...tanAnfrage(ref(hktan), hktan.orderRef!, "ausstehend")] };
  }
  if (hktan.tanProcess === "2" && anfrage.tan !== bank.tan) {
    return { dialogId, segmente: ["HIRMG:{n}:2+9050::Teilweise fehlerhaft.", `HIRMS:{n}:2:${ref(hktan)}+9941::TAN ungültig.`] };
  }
  bank.offen.delete(hktan.orderRef!);
  bank.zustand.freigegeben = false;
  if (auftrag.art === "HKIDN") {
    bank.zustand.scaBeiAnmeldung = false;
    return { dialogId, segmente: [OK, `HIRMS:{n}:2:${ref(hktan)}+0020::Freigabe erteilt.`, ...upd(bank, ref(hktan))] };
  }
  bank.zustand.scaBeiUmsaetzen = false;
  return { dialogId, segmente: [OK, ...umsatzAntwort(bank, ref(hktan), auftrag.iban, auftrag.von, auftrag.bis)] };
}

/** HKKAZ: Umsätze als MT940, oder mit SCA erst eine TAN-Anfrage */
function umsatzAbruf(bank: Bank, segmente: Seg[], anfrage: FintsTestbankAnfrage, dialogId: string): Antwort {
  const kaz = feld<{ account: { iban?: string }; from?: Date; to?: Date }>(segmente, "HKKAZ")!;
  const hktan = feld(segmente, "HKTAN");
  const iban = kaz.account.iban;
  const von = fintsDay(kaz.from);
  const bis = fintsDay(kaz.to);
  Object.assign(anfrage, { iban, von, bis });
  if (!hktan && bank.zustand.umsatzTanVerschwiegen) {
    // So antwortete die Consorsbank mit ihrem App-Verfahren (Speicherstadt/haben#654)
    return {
      dialogId,
      segmente: ["HIRMG:{n}:2+9050::Nachricht teilweise fehlerhaft.", `HIRMS:{n}:2:${ref(kaz)}+9075::Starke Authentifizierung erforderlich.`],
    };
  }
  if (hktan && bank.zustand.scaBeiUmsaetzen) {
    const referenz = `REF${++bank.zaehler}`;
    bank.offen.set(referenz, { art: "HKKAZ", eintippen: anfrage.verfahren !== PUSH, iban, von, bis });
    return { dialogId, segmente: [OK, ...tanAnfrage(ref(hktan), referenz, anfrage.verfahren === PUSH ? "app" : "tan")] };
  }
  return { dialogId, segmente: [OK, ...umsatzAntwort(bank, ref(kaz), iban, von, bis)] };
}

function antworte(bank: Bank, segmente: Seg[], anfrage: FintsTestbankAnfrage): Antwort {
  const idn = feld<{ customerId: string; bank: { bankId: string } }>(segmente, "HKIDN");
  const hktan = feld<{ tanProcess: string; orderRef?: string }>(segmente, "HKTAN");
  const ende = feld(segmente, "HKEND");
  const dialogId = idn ? `D${++bank.zaehler}` : (feld<{ dialogId: string }>(segmente, "HNHBK")?.dialogId ?? "0");
  // Wie eine Bank, die die Registrierungsnummer (noch) nicht kennt (so antwortete eine echte Bank, Speicherstadt/haben#1289)
  if (idn && anfrage.produktId !== bank.optionen.produktId) {
    return { dialogId, segmente: ["HIRMG:{n}:2+9050::Teilweise fehlerhaft.", "HIRMS:{n}:2+9952::Das Kundenprodukt wird nicht unterstützt."] };
  }
  if (anfrage.pin !== bank.pin || (idn && (idn.customerId !== bank.benutzer || idn.bank.bankId !== bank.blz))) {
    return { dialogId, segmente: ["HIRMG:{n}:2+9800::Dialog abgebrochen.", "HIRMS:{n}:2+9942::PIN ungültig."] };
  }
  if (idn) return anmeldung(bank, segmente, anfrage, dialogId);
  if (hktan && (hktan.tanProcess === "2" || hktan.tanProcess === "S")) return tanFortsetzung(bank, hktan, anfrage, dialogId);
  if (feld(segmente, "HKKAZ")) return umsatzAbruf(bank, segmente, anfrage, dialogId);
  if (ende) return { dialogId, segmente: [OK, `HIRMS:{n}:2:${ref(ende)}+0100::Dialog beendet.`] };
  return { dialogId, segmente: ["HIRMG:{n}:2+9010::Nachricht nicht verstanden."] };
}

/** Liest eine Nachricht von lib-fints (base64, latin1) und antwortet wie eine Bank */
function beantworten(bank: Bank, body: Buffer): string {
  const text = Buffer.from(body.toString("utf8"), "base64").toString("latin1");
  const segmente = Message.decode(text).segments as Seg[];
  const unterschrift = feld<{ customSignature?: { pin: string; tan?: string } }>(segmente, "HNSHA");
  const anfrage: FintsTestbankAnfrage = {
    segmente: segmente.map((s) => s.header.segId),
    produktId: feld<{ productId: string }>(segmente, "HKVVB")?.productId,
    pin: unterschrift?.customSignature?.pin,
    tan: unterschrift?.customSignature?.tan,
    tanProzess: feld<{ tanProcess: string }>(segmente, "HKTAN")?.tanProcess,
    verfahren: feld<{ secFunc: number }>(segmente, "HNSHK")?.secFunc,
  };
  bank.zustand.anfragen.push(anfrage);
  const msgNr = feld<{ msgNr: number }>(segmente, "HNHBK")?.msgNr ?? 1;
  const { dialogId, segmente: antwort } = antworte(bank, segmente, anfrage);
  return Buffer.from(nachricht(dialogId, msgNr, antwort), "latin1").toString("base64");
}

export async function startFintsTestbank(optionen: FintsTestbankOptionen): Promise<FintsTestbank> {
  const bank: Bank = {
    blz: optionen.blz ?? "12030000",
    benutzer: optionen.benutzer ?? "max",
    pin: optionen.pin ?? "12345",
    tan: optionen.tan ?? "123456",
    optionen,
    konten: optionen.konten ?? [],
    zustand: {
      scaBeiAnmeldung: false,
      scaBeiUmsaetzen: false,
      freigegeben: false,
      appTanEintippen: false,
      umsatzTanVerschwiegen: false,
      nichtErreichbar: false,
      mt940Unlesbar: false,
      anfragen: [],
    },
    offen: new Map(),
    zaehler: 0,
  };
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (c: Buffer) => chunks.push(c));
    request.on("end", () => {
      if (bank.zustand.nichtErreichbar) {
        response.writeHead(503).end("Wartung");
        return;
      }
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(beantworten(bank, Buffer.concat(chunks)));
    });
  });
  await new Promise<void>((resolve) => server.listen(optionen.port ?? 0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : optionen.port;
  return {
    url: `http://127.0.0.1:${port}/fints`,
    zustand: bank.zustand,
    schliessen: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
