import { createServer, type Server } from "node:http";
import { Message, type Segment } from "lib-fints";
import { fintsDay } from "./map.ts";

/**
 * Nachgebaute FinTS-Bank für Tests (nur über `@haben/import/fints-testbank`, nicht im Paket): ein HTTP-Server, der
 * Nachrichten von lib-fints liest und mit echten FinTS-Segmenten antwortet. Er kennt Dialogaufbau mit BPD, UPD und
 * Kundensystem-ID, zwei TAN-Verfahren (pushTAN entkoppelt, chipTAN mit TAN), starke Kundenauthentifizierung bei der
 * Anmeldung oder beim Umsatzabruf (je einmal, wie die 90-Tage-Ausnahme nach PSD2) und Umsätze als MT940 (HKKAZ).
 * Segmente und Rückmeldungen nach FinTS 3.0 (Formals, PIN/TAN); die Codes der Fehler sind nachgestellt, nicht die
 * einer bestimmten Bank.
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
    /** Antwortet mit HTTP 503 */
    nichtErreichbar: boolean;
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

function mt940(blz: string, konto: FintsTestbankKonto, umsaetze: FintsTestbankUmsatz[], von: string, bis: string): string {
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
    zeilen.push(`:61:${yymmdd(u.tag)}${u.tag.slice(5).replace("-", "")}${cd(c)}R${betragMt940(c)}NTRFNONREF//${u.ref}`);
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

export async function startFintsTestbank(optionen: FintsTestbankOptionen): Promise<FintsTestbank> {
  const blz = optionen.blz ?? "12030000";
  const benutzer = optionen.benutzer ?? "max";
  const pin = optionen.pin ?? "12345";
  const tan = optionen.tan ?? "123456";
  const konten = optionen.konten ?? [];
  const zustand: FintsTestbank["zustand"] = { scaBeiAnmeldung: false, scaBeiUmsaetzen: false, freigegeben: false, nichtErreichbar: false, anfragen: [] };
  const offen = new Map<string, { art: "HKIDN" | "HKKAZ"; iban?: string; von?: string; bis?: string }>();
  let zaehler = 0;

  const bpd = (ref: number) => [
    `HIBPA:{n}:3:${ref}+1+280:${blz}+${esc(optionen.bankname ?? "Testbank")}+1+1+300`,
    `HITANS:{n}:7:${ref}+1+1+0+J:N:0:${PUSH}:2:pushTAN2.0:Decoupled::pushTAN 2.0:::Freigabe:2048:N:2:N:0:0:N:N:00:0:N:1:60:1:1:J:J:${CHIPTAN}:2:HHD1.3.0:HHD:1.3.0:chipTAN manuell:6:1:TAN-Nummer:2048:N:2:N:0:0:N:N:00:0:N:1`,
    `HIPINS:{n}:1:${ref}+1+1+0+5:20:6:Anmeldename:Kunden-ID:HKKAZ:J:HKSAL:N:HKTAN:N:HKIDN:J:HKTAB:N`,
    `HIKAZS:{n}:7:${ref}+1+1+0+90:N:N`,
  ];
  const upd = (ref: number) => [
    `HIUPA:{n}:4:${ref}+${esc(benutzer)}+1+0`,
    ...konten.map(
      (k) => `HIUPD:{n}:6:${ref}+${k.nummer}::280:${blz}+${k.iban}+${esc(benutzer)}+1+${k.waehrung ?? "EUR"}+Max Mustermann++${esc(k.name)}++HKKAZ:1+HKSAL:1`,
    ),
  ];
  const umsatzAntwort = (ref: number, iban = "", von = "2000-01-01", bis = "2099-12-31") => {
    const konto = konten.find((k) => k.iban === iban);
    if (!konto) return [`HIRMS:{n}:2:${ref}+9210::Konto unbekannt.`];
    const daten = mt940(blz, konto, optionen.umsaetze?.[iban] ?? [], von, bis);
    return [`HIRMS:{n}:2:${ref}+0020::Der Auftrag wurde ausgeführt.`, `HIKAZ:{n}:7:${ref}+@${Buffer.byteLength(daten, "latin1")}@${daten}`];
  };
  const tanAnfrage = (ref: number, referenz: string, entkoppelt: boolean, code = "0030") => [
    `HIRMS:{n}:2:${ref}+${code}::${entkoppelt ? "Bitte in der App freigeben." : "Auftrag empfangen - Sicherheitsfreigabe erforderlich."}`,
    `HITAN:{n}:7:${ref}+4++${referenz}+${entkoppelt ? "Bitte bestätigen Sie den Zugriff in Ihrer Banking-App." : "Bitte geben Sie die TAN ein."}`,
  ];

  function antworte(segmente: Seg[], anfrage: FintsTestbankAnfrage): { dialogId: string; segmente: string[] } {
    const kopf = feld<{ dialogId: string }>(segmente, "HNHBK");
    const idn = feld<{ customerId: string; bank: { bankId: string }; systemId: string }>(segmente, "HKIDN");
    const vvb = feld<{ productId: string; bpdVersion: number; updVersion: number }>(segmente, "HKVVB");
    const syn = feld(segmente, "HKSYN");
    const hktan = feld<{ tanProcess: string; segId?: string; orderRef?: string }>(segmente, "HKTAN");
    const kaz = feld<{ account: { iban?: string }; from?: Date; to?: Date }>(segmente, "HKKAZ");
    const ende = feld(segmente, "HKEND");
    const dialogId = idn ? `D${++zaehler}` : (kopf?.dialogId ?? "0");
    const ref = (s: Seg | undefined) => s?.header.segNr ?? 0;
    const ok = "HIRMG:{n}:2+0010::Nachricht entgegengenommen.";

    if (anfrage.pin !== pin || (idn && (idn.customerId !== benutzer || idn.bank.bankId !== blz))) {
      return { dialogId, segmente: ["HIRMG:{n}:2+9800::Dialog abgebrochen.", "HIRMS:{n}:2+9931::Anmeldename oder PIN ist falsch."] };
    }
    if (idn) {
      const verfahren = anfrage.verfahren ?? 999;
      const antwort = [ok, `HIRMS:{n}:2:${ref(vvb)}+3920::Zugelassene Zwei-Schritt-Verfahren für den Benutzer.:${PUSH}:${CHIPTAN}+0020::Dialog initialisiert.`];
      if (!vvb || vvb.bpdVersion < 1) antwort.push(...bpd(ref(vvb)));
      if (syn) antwort.push(`HISYN:{n}:4:${ref(syn)}+SYS${zaehler}`);
      if (verfahren === 999 || !hktan) return { dialogId, segmente: antwort };
      if (zustand.scaBeiAnmeldung) {
        const referenz = `REF${zaehler}`;
        offen.set(referenz, { art: "HKIDN" });
        return { dialogId, segmente: [...antwort, ...tanAnfrage(ref(hktan), referenz, verfahren === PUSH)] };
      }
      return { dialogId, segmente: [...antwort, `HIRMS:{n}:2:${ref(hktan)}+3076::Starke Kundenauthentifizierung nicht notwendig.`, ...upd(ref(vvb))] };
    }
    if (hktan && (hktan.tanProcess === "2" || hktan.tanProcess === "S")) {
      const auftrag = offen.get(hktan.orderRef ?? "");
      if (!auftrag) return { dialogId, segmente: ["HIRMG:{n}:2+9050::Teilweise fehlerhaft.", `HIRMS:{n}:2:${ref(hktan)}+9210::Auftragsreferenz unbekannt.`] };
      if (hktan.tanProcess === "S" && !zustand.freigegeben) {
        return { dialogId, segmente: [ok, ...tanAnfrage(ref(hktan), hktan.orderRef!, true, "3956")] };
      }
      if (hktan.tanProcess === "2" && anfrage.tan !== tan) {
        return { dialogId, segmente: ["HIRMG:{n}:2+9050::Teilweise fehlerhaft.", `HIRMS:{n}:2:${ref(hktan)}+9941::TAN ungültig.`] };
      }
      offen.delete(hktan.orderRef!);
      zustand.freigegeben = false;
      if (auftrag.art === "HKIDN") {
        zustand.scaBeiAnmeldung = false;
        return { dialogId, segmente: [ok, `HIRMS:{n}:2:${ref(hktan)}+0020::Freigabe erteilt.`, ...upd(ref(hktan))] };
      }
      zustand.scaBeiUmsaetzen = false;
      return { dialogId, segmente: [ok, ...umsatzAntwort(ref(hktan), auftrag.iban, auftrag.von, auftrag.bis)] };
    }
    if (kaz) {
      const iban = kaz.account.iban;
      const von = fintsDay(kaz.from);
      const bis = fintsDay(kaz.to);
      Object.assign(anfrage, { iban, von, bis });
      if (hktan && zustand.scaBeiUmsaetzen) {
        const referenz = `REF${++zaehler}`;
        offen.set(referenz, { art: "HKKAZ", iban, von, bis });
        return { dialogId, segmente: [ok, ...tanAnfrage(ref(hktan), referenz, anfrage.verfahren === PUSH)] };
      }
      return { dialogId, segmente: [ok, ...umsatzAntwort(ref(kaz), iban, von, bis)] };
    }
    if (ende) return { dialogId, segmente: [ok, `HIRMS:{n}:2:${ref(ende)}+0100::Dialog beendet.`] };
    return { dialogId, segmente: ["HIRMG:{n}:2+9010::Nachricht nicht verstanden."] };
  }

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (c: Buffer) => chunks.push(c));
    request.on("end", () => {
      if (zustand.nichtErreichbar) {
        response.writeHead(503).end("Wartung");
        return;
      }
      const text = Buffer.from(Buffer.concat(chunks).toString("utf8"), "base64").toString("latin1");
      const segmente = Message.decode(text).segments as Seg[];
      const unterschrift = feld<{ customSignature?: { pin: string; tan?: string } }>(segmente, "HNSHA");
      const anfrage: FintsTestbankAnfrage = {
        segmente: segmente.map((s) => s.header.segId),
        produktId: feld<{ productId: string }>(segmente, "HKVVB")?.productId,
        pin: unterschrift?.customSignature?.pin,
        tan: unterschrift?.customSignature?.tan,
        verfahren: feld<{ secFunc: number }>(segmente, "HNSHK")?.secFunc,
      };
      zustand.anfragen.push(anfrage);
      const msgNr = feld<{ msgNr: number }>(segmente, "HNHBK")?.msgNr ?? 1;
      const { dialogId, segmente: antwort } = antworte(segmente, anfrage);
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(Buffer.from(nachricht(dialogId, msgNr, antwort), "latin1").toString("base64"));
    });
  });
  await new Promise<void>((resolve) => server.listen(optionen.port ?? 0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : optionen.port;
  return {
    url: `http://127.0.0.1:${port}/fints`,
    zustand,
    schliessen: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
