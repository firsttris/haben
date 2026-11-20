import { Message, type Segment } from "lib-fints";
import { afterEach, expect, it, vi } from "vitest";
import { fintsClient, fintsSynchronisieren } from "./sitzung.ts";

const URL = "https://banking-rl7.s-fints-pt-rl.de/fints30";
const PRODUKT = { id: "TESTPRODUKT0123456789ABCD", version: "0.11" };
const ZUGANG = { url: URL, blz: "37050198", benutzer: "testperson", pin: "test-pin" };
const OK = "HIRMG:{n}:2+0010::Nachricht entgegengenommen.";
const BPD = [
  "HIBPA:{n}:3+1+280:37050198+Testbank+1+1+300",
  "HITANS:{n}:7+1+1+0+J:N:0:923:2:pushTAN2.0:Decoupled::pushTAN 2.0:::Freigabe:2048:N:2:N:0:0:N:N:00:2:N:1:60:1:1:J:J",
  "HIPINS:{n}:1+1+1+0+5:20:6:Anmeldename:Kunden-ID:HKIDN:J:HKTAB:N",
  "HITABS:{n}:5+1+1+0",
];

function antwort(segmente: string[], msgNr: number): Response {
  const rumpf = [...segmente.map((s, i) => s.replace("{n}", String(i + 2))), `HNHBS:${segmente.length + 2}:1+${msgNr}`].join("'") + "'";
  const kopf = (laenge: number) => `HNHBK:1:3+${String(laenge).padStart(12, "0")}+300+TEST-DIALOG+${msgNr}+TEST-DIALOG:${msgNr}'`;
  const text = kopf(Buffer.byteLength(kopf(0) + rumpf, "latin1")) + rumpf;
  return new Response(Buffer.from(text, "latin1").toString("base64"));
}

type TestSegment = Segment & {
  customSignature?: { pin: string };
  tanMedia?: string;
  tanProcess?: string;
  msgNr?: number;
};

afterEach(() => vi.restoreAllMocks());

it.each([false, true])("lädt das akzeptierte Fallback-Medium nach abgelehntem Medienabruf wieder (mit Freigabe: %s)", async (freigabe) => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const nachricht = Message.decode(Buffer.from(String(init?.body), "base64").toString("latin1"));
    const feld = (id: string) => nachricht.segments.find((s) => s.header.segId === id) as TestSegment | undefined;
    const msgNr = feld("HNHBK")?.msgNr ?? 1;
    if (feld("HKIDN")) {
      if (!feld("HNSHA")?.customSignature?.pin) return antwort([OK, ...BPD], msgNr);
      if (feld("HKTAN")?.tanMedia !== "Alle Geräte") {
        return antwort(["HIRMG:{n}:2+9050::Nachricht fehlerhaft.", "HIRMS:{n}:2+9955::Die Gerätebezeichnung ist unbekannt.+3920::Erlaubt.:923"], msgNr);
      }
      if (freigabe)
        return antwort(
          [OK, "HIRMS:{n}:2+0030::Freigabe erforderlich.+3955::Sicherheitsfreigabe erfolgt über anderen Kanal.", "HITAN:{n}:7+4++TEST-REF+Bitte freigeben"],
          msgNr,
        );
      return antwort([OK, "HIRMS:{n}:2+0020::Auftrag ausgeführt.+3920::Erlaubt.:923", "HISYN:{n}:4+TEST-SYSTEM"], msgNr);
    }
    if (feld("HKTAN")?.tanProcess === "S") return antwort([OK, "HIRMS:{n}:2+0020::Freigegeben.+3920::Erlaubt.:923", "HISYN:{n}:4+TEST-SYSTEM"], msgNr);
    if (feld("HKTAB")) {
      return antwort(["HIRMG:{n}:2+9050::Nachricht fehlerhaft.", "HIRMS:{n}:2+9010::Auftrag nicht verarbeitet."], msgNr);
    }
    expect(feld("HKEND")).toBeDefined();
    return antwort([OK], msgNr);
  });

  const client = fintsClient(PRODUKT, ZUGANG);
  const anmeldung = await fintsSynchronisieren(client);
  if (freigabe) {
    expect(anmeldung).toMatchObject({ art: "tan", anfrage: { referenz: "TEST-REF", entkoppelt: true } });
    expect((await fintsSynchronisieren(client, { referenz: "TEST-REF" })).art).toBe("ok");
  } else expect(anmeldung.art).toBe("ok");
  const gespeichert = JSON.parse(JSON.stringify(client.config.bankingInformation));
  expect(() => fintsClient(PRODUKT, ZUGANG, { bankingInformation: gespeichert, tanVerfahren: 923, tanMedium: client.config.tanMediaName })).not.toThrow();
});
