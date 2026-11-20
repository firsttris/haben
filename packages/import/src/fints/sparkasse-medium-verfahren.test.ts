import { Message, type Segment } from "lib-fints";
import { afterEach, expect, it, vi } from "vitest";
import { fintsClient, fintsSynchronisieren } from "./sitzung.ts";

const URL = "https://banking-rl7.s-fints-pt-rl.de/fints30";
const PRODUKT = { id: "TESTPRODUKT0123456789ABCD", version: "0.11" };
const ZUGANG = { url: URL, blz: "37050198", benutzer: "testperson", pin: "test-pin" };
const OK = "HIRMG:{n}:2+0010::Nachricht entgegengenommen.";
const PUSH = "923:2:pushTAN2.0:Decoupled::pushTAN 2.0:::Freigabe:2048:N:2:N:0:0:N:N:00:2:N:1:60:1:1:J:J";
const CHIP = "912:2:HHD1.4:HHD:1.4:chipTAN optisch:6:1:TAN-Nummer:2048:N:2:N:0:0:N:N:00:0:N:0";
const BPD = [
  "HIBPA:{n}:3+1+280:37050198+Testbank+1+1+300",
  `HITANS:{n}:7+1+1+0+J:N:0:${PUSH}:${CHIP}`,
  "HIPINS:{n}:1+1+1+0+5:20:6:Anmeldename:Kunden-ID:HKIDN:J:HKTAB:N",
  "HITABS:{n}:5+1+1+0",
];

function antwort(segmente: string[], msgNr: number): Response {
  const rumpf = `${[...segmente.map((s, i) => s.replace("{n}", String(i + 2))), `HNHBS:${segmente.length + 2}:1+${msgNr}`].join("'")}'`;
  const kopf = (laenge: number) => `HNHBK:1:3+${String(laenge).padStart(12, "0")}+300+TEST-DIALOG+${msgNr}+TEST-DIALOG:${msgNr}'`;
  return new Response(Buffer.from(kopf(Buffer.byteLength(kopf(0) + rumpf, "latin1")) + rumpf, "latin1").toString("base64"));
}

type TestSegment = Segment & { customSignature?: { pin: string }; tanMedia?: string; msgNr?: number };

afterEach(() => vi.restoreAllMocks());

it("speichert Alle Geräte nicht für ein danach gewähltes anderes TAN-Verfahren", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const nachricht = Message.decode(Buffer.from(String(init?.body), "base64").toString("latin1"));
    const feld = (id: string) => nachricht.segments.find((s) => s.header.segId === id) as TestSegment | undefined;
    const msgNr = feld("HNHBK")?.msgNr ?? 1;
    if (feld("HKIDN")) {
      if (!feld("HNSHA")?.customSignature?.pin) return antwort([OK, ...BPD], msgNr);
      const verfahren = (feld("HNSHK") as Segment & { secFunc?: number })?.secFunc;
      if ((verfahren === 923 && feld("HKTAN")?.tanMedia !== "Alle Geräte") || verfahren === 999) {
        return antwort(["HIRMG:{n}:2+9050::Nachricht fehlerhaft.", "HIRMS:{n}:2+9955::Die Gerätebezeichnung ist unbekannt.+3920::Erlaubt.:912:923"], msgNr);
      }
      return antwort([OK, "HIRMS:{n}:2+0020::Ausgeführt.+3920::Erlaubt.:912:923", "HISYN:{n}:4+TEST-SYSTEM", "HIUPA:{n}:4+testperson+1+0"], msgNr);
    }
    if (feld("HKTAB")) return antwort([OK, `HITAB:{n}:5+0+${["F", "1", "923", "", "", "", "", "", "", "", "", "", "", "Alle Geräte"].join(":")}`], msgNr);
    return antwort([OK], msgNr);
  });

  // Ablauf wie fintsVerbinden → verfahrenWaehlen → mitVerfahren → speichern in apps/web/src/server/modules/bank/fints.ts
  const client = fintsClient(PRODUKT, ZUGANG);
  expect((await fintsSynchronisieren(client)).art).toBe("ok");
  expect(client.config.tanMediaName).toBe("Alle Geräte");
  client.selectTanMethod(912);
  expect((await fintsSynchronisieren(client)).art).toBe("ok");
  const gespeichert = {
    bankingInformation: JSON.parse(JSON.stringify(client.config.bankingInformation)),
    tanVerfahren: client.config.tanMethodId ?? null,
    tanMedium: client.config.tanMediaName ?? null,
  };
  expect(() => fintsClient(PRODUKT, ZUGANG, gespeichert)).not.toThrow();
});
