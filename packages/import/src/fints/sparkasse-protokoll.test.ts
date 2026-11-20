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

function antwort(segmente: string[], msgNr: number, dialogId = "TEST-DIALOG"): Response {
  const rumpf = [...segmente.map((s, i) => s.replace("{n}", String(i + 2))), `HNHBS:${segmente.length + 2}:1+${msgNr}`].join("'") + "'";
  const kopf = (laenge: number) => `HNHBK:1:3+${String(laenge).padStart(12, "0")}+300+${dialogId}+${msgNr}+${dialogId}:${msgNr}'`;
  const text = kopf(Buffer.byteLength(kopf(0) + rumpf, "latin1")) + rumpf;
  return new Response(Buffer.from(text, "latin1").toString("base64"));
}

type TestSegment = Segment & {
  customSignature?: { pin: string };
  secFunc?: number;
  customerId?: string;
  tanMedia?: string;
  tanProcess?: string;
  msgNr?: number;
};

afterEach(() => vi.restoreAllMocks());

it("überträgt nach 9955 öffentliche BPD ohne PIN und Alle Geräte im echten HKTAN; pushTAN lässt sich fortsetzen und speichern", async () => {
  const anfragen: { pin?: string; benutzer?: string; medium?: string; verfahren?: number }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    expect(url).toBe(URL);
    const nachricht = Message.decode(Buffer.from(String(init?.body), "base64").toString("latin1"));
    const feld = (id: string) => nachricht.segments.find((s) => s.header.segId === id) as TestSegment | undefined;
    const idn = feld("HKIDN");
    const tan = feld("HKTAN");
    const pin = feld("HNSHA")?.customSignature?.pin;
    const msgNr = feld("HNHBK")?.msgNr ?? 1;
    if (idn) {
      anfragen.push({ pin, benutzer: idn.customerId, medium: tan?.tanMedia, verfahren: feld("HNSHK")?.secFunc });
      if (!pin) return antwort([OK, ...BPD], msgNr);
      if (tan?.tanMedia !== "Alle Geräte") {
        // BPD stehen sogar in der Ablehnung, werden von lib-fints 1.5.3 aber nicht übernommen.
        return antwort(["HIRMG:{n}:2+9050::Nachricht fehlerhaft.", "HIRMS:{n}:2+9955::Die Gerätebezeichnung ist unbekannt.+3920::Erlaubt.:923", ...BPD], msgNr);
      }
      expect(feld("HNSHK")?.secFunc).toBe(923);
      return antwort(
        [OK, "HIRMS:{n}:2+0030::Freigabe erforderlich.+3955::Sicherheitsfreigabe erfolgt über anderen Kanal.", "HITAN:{n}:7+4++TEST-REF+Bitte freigeben"],
        msgNr,
      );
    }
    if (tan?.tanProcess === "S") {
      expect(tan.tanMedia).toBe("Alle Geräte");
      return antwort([OK, "HIRMS:{n}:2+0020::Freigegeben.+3920::Erlaubt.:923", "HISYN:{n}:4+TEST-SYSTEM", "HIUPA:{n}:4+testperson+1+0"], msgNr);
    }
    if (feld("HKTAB")) {
      const medium = ["F", "1", "923", "", "", "", "", "", "", "", "", "", "", "Alle Geräte"].join(":");
      return antwort([OK, `HITAB:{n}:5+0+${medium}`], msgNr);
    }
    expect(feld("HKEND")).toBeDefined();
    return antwort([OK], msgNr);
  });

  const client = fintsClient(PRODUKT, ZUGANG);
  const anfrage = await fintsSynchronisieren(client);
  expect(anfrage).toMatchObject({ art: "tan", anfrage: { referenz: "TEST-REF", entkoppelt: true } });
  expect((await fintsSynchronisieren(client, { referenz: "TEST-REF" })).art).toBe("ok");
  expect(anfragen).toEqual([
    { pin: "test-pin", benutzer: "testperson", medium: undefined, verfahren: 999 },
    { pin: undefined, benutzer: "9999999999", medium: undefined, verfahren: undefined },
    { pin: "test-pin", benutzer: "testperson", medium: "Alle Geräte", verfahren: 923 },
  ]);
  const gespeichert = JSON.parse(JSON.stringify(client.config.bankingInformation));
  const wieder = fintsClient(PRODUKT, ZUGANG, { bankingInformation: gespeichert, tanVerfahren: 923, tanMedium: client.config.tanMediaName });
  expect(wieder.config.tanMediaName).toBe("Alle Geräte");
  expect(wieder.config.bankingInformation.systemId).toBe("TEST-SYSTEM");
});
