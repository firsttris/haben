import { Message, type Segment } from "lib-fints";
import { afterEach, expect, it, vi } from "vitest";
import { fintsClient, fintsKonten, fintsSynchronisieren, fintsUmsaetze } from "./sitzung.ts";

const URL = "https://banking-rl7.s-fints-pt-rl.de/fints30";
const PRODUKT = { id: "TESTPRODUKT0123456789ABCD", version: "0.11" };
const ZUGANG = { url: URL, blz: "37050198", benutzer: "testperson", pin: "test-pin" };
const OK = "HIRMG:{n}:2+0010::Nachricht entgegengenommen.";
const BPD = [
  "HIBPA:{n}:3+{version}+280:37050198+Testbank+1+1+300",
  "HITANS:{n}:7+1+1+0+J:N:0:923:2:pushTAN2.0:Decoupled::pushTAN 2.0:::Freigabe:2048:N:2:N:0:0:N:N:00:2:N:1:60:1:1:J:J",
  "HIPINS:{n}:1+1+1+0+5:20:6:Anmeldename:Kunden-ID:HKIDN:J:HKTAB:N:HKKAZ:N",
  "HITABS:{n}:5+1+1+0",
  "HIKAZS:{n}:7+1+1+0+90:N:N",
];
const UPD = ["HIUPA:{n}:4+testperson+1+0", "HIUPD:{n}:6+0000202051::280:37050198+DE02370501980000202051+testperson+1+EUR+Max Mustermann++Girokonto++HKKAZ:1"];

function antwort(segmente: string[], msgNr: number): Response {
  const rumpf = [...segmente.map((s, i) => s.replace("{n}", String(i + 2))), `HNHBS:${segmente.length + 2}:1+${msgNr}`].join("'") + "'";
  const kopf = (laenge: number) => `HNHBK:1:3+${String(laenge).padStart(12, "0")}+300+TEST-DIALOG+${msgNr}+TEST-DIALOG:${msgNr}'`;
  const text = kopf(Buffer.byteLength(kopf(0) + rumpf, "latin1")) + rumpf;
  return new Response(Buffer.from(text, "latin1").toString("base64"));
}

type TestSegment = Segment & { customSignature?: { pin: string }; tanMedia?: string; msgNr?: number };

afterEach(() => vi.restoreAllMocks());

it("lädt das bestätigte Sparkassen-Medium nach neuen BPD beim späteren Umsatzabruf wieder", async () => {
  let version = 1;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const nachricht = Message.decode(Buffer.from(String(init?.body), "base64").toString("latin1"));
    const feld = (id: string) => nachricht.segments.find((s) => s.header.segId === id) as TestSegment | undefined;
    const msgNr = feld("HNHBK")?.msgNr ?? 1;
    if (feld("HKIDN")) {
      const bpd = BPD.map((s) => s.replace("{version}", String(version)));
      if (!feld("HNSHA")?.customSignature?.pin) return antwort([OK, ...bpd], msgNr);
      if (feld("HKTAN")?.tanMedia !== "Alle Geräte") {
        return antwort(["HIRMG:{n}:2+9050::Nachricht fehlerhaft.", "HIRMS:{n}:2+9955::Die Gerätebezeichnung ist unbekannt.+3920::Erlaubt.:923"], msgNr);
      }
      return antwort([OK, "HIRMS:{n}:2+0020::Auftrag ausgeführt.+3920::Erlaubt.:923", ...bpd, ...UPD, "HISYN:{n}:4+TEST-SYSTEM"], msgNr);
    }
    if (feld("HKTAB")) return antwort(["HIRMG:{n}:2+9050::Nachricht fehlerhaft.", "HIRMS:{n}:2+9010::Auftrag nicht verarbeitet."], msgNr);
    if (feld("HKKAZ")) return antwort([OK, "HIRMS:{n}:2+0020::Keine Umsätze."], msgNr);
    expect(feld("HKEND")).toBeDefined();
    return antwort([OK], msgNr);
  });

  const client = fintsClient(PRODUKT, ZUGANG);
  expect((await fintsSynchronisieren(client)).art).toBe("ok");
  const gespeichert = () => ({
    bankingInformation: JSON.parse(JSON.stringify(client.config.bankingInformation)),
    tanVerfahren: 923,
    tanMedium: client.config.tanMediaName,
  });
  expect(() => fintsClient(PRODUKT, ZUGANG, gespeichert())).not.toThrow();
  version = 2;
  expect((await fintsUmsaetze(client, fintsKonten(client).abrufbar[0]!, "2026-11-01", "2026-11-20")).art).toBe("abgelehnt");
  expect(client.config.bankingInformation.bpd?.version).toBe(2);
  expect(() => fintsClient(PRODUKT, ZUGANG, gespeichert())).not.toThrow();
});
