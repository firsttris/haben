import { describe, expect, it } from "vitest";
import { direktBuchungenFuerKonto, direktKategorienFuerKonto } from "./konto-angebot.ts";
import { directBookingLabel } from "./posting.ts";
import type { Rechtsform } from "./rechtsform.ts";

/*
 * Angebot im Bankabgleich je Kontozweck (#873): Auf einem privaten Konto entfallen genau vier Möglichkeiten —
 * Kontoführung und Bankgebühren, Zinserträge, Privat und Geldtransit. Die Umsätze dort bleiben zuordenbar, deshalb bleibt
 * alles andere im Angebot.
 */

/** Wie der Server-Loader (apps/web/src/server/functions/bank.ts) die Optionen des Abgleichs zusammenstellt */
function angebot(rechtsform: Rechtsform, zweck: "geschaeft" | "privat") {
  return {
    directKinds: direktBuchungenFuerKonto(rechtsform, zweck).map((value) => ({ value, label: directBookingLabel(value, rechtsform) })),
    kategorien: direktKategorienFuerKonto(zweck),
  };
}

/** Die vier Möglichkeiten, die es auf einem privaten Konto nicht gibt */
const NUR_GESCHAEFT = ["gebuehren", "zinsertrag", "privat", "geldtransit"] as const;

/** Dazu die Spende: sie bucht dort privat gegen privat. Nur im Einzelunternehmen überhaupt vorhanden (#873) */
const AUCH_NUR_GESCHAEFT = [...NUR_GESCHAEFT, "spende"] as const;

describe("Angebot im Bankabgleich je Kontozweck", () => {
  for (const rechtsform of ["einzelunternehmen", "gmbh"] as const) {
    it(`Geschäftskonto (${rechtsform}) bietet alle Buchungsarten ohne Beleg`, () => {
      const { directKinds } = angebot(rechtsform, "geschaeft");
      for (const kind of NUR_GESCHAEFT) expect(directKinds.map((k) => k.value)).toContain(kind);
      // Die Beschriftung kommt weiter aus der Rechtsform: „privat“ heißt in GmbH und UG Gesellschafter-Verrechnungskonto
      expect(directKinds.find((k) => k.value === "privat")?.label).toBe(directBookingLabel("privat", rechtsform));
    });

    it(`Privatkonto (${rechtsform}) lässt genau die vier entfallen`, () => {
      const geschaeft = angebot(rechtsform, "geschaeft").directKinds.map((k) => k.value);
      const privat = angebot(rechtsform, "privat").directKinds.map((k) => k.value);
      for (const kind of NUR_GESCHAEFT) expect(privat).not.toContain(kind);
      // Alles andere bleibt, etwa Umsatzsteuer, Sondervorauszahlung, Mahnerlöse und die Buchungen der Rechtsform
      expect(privat).toEqual(geschaeft.filter((kind) => !(AUCH_NUR_GESCHAEFT as readonly string[]).includes(kind)));
      expect(privat).toContain("ustVorauszahlung");
      expect(privat).toContain("mahnerloes");
      if (rechtsform === "gmbh") expect(privat).toContain("kapest");
      // Die Spende fällt wie die vier weg: sie bucht auf einem privaten Konto privat gegen privat (#873)
      expect(privat).not.toContain("spende");
    });
  }

  it("Gegenprobe: Privat und Geldtransit bleiben auf einem Geschäftskonto", () => {
    for (const rechtsform of ["einzelunternehmen", "gmbh"] as const) {
      const werte = angebot(rechtsform, "geschaeft").directKinds.map((k) => k.value);
      expect(werte).toContain("privat");
      expect(werte).toContain("geldtransit");
    }
  });

  it("Kategorien: auf einem privaten Konto entfällt keine, Bankgebühren fehlen in beiden", () => {
    const geschaeft = angebot("einzelunternehmen", "geschaeft").kategorien;
    const privat = angebot("einzelunternehmen", "privat").kategorien;
    // Geschäftsausgaben und Erlöse, die über das Privatkonto laufen, bleiben buchbar
    expect(privat).toEqual(geschaeft);
    expect(privat.map((k) => k.value)).toContain("telefon");
    expect(privat.map((k) => k.value)).toContain("erloese");
    // Bankgebühren gibt es schon als Buchungsart, nicht noch einmal als Kategorie
    expect(privat.map((k) => k.value)).not.toContain("geldverkehr");
  });

  it("Loader: ein privates Konto bekommt die eingeschränkten Listen, ein Geschäftskonto die vollen", () => {
    const privat = angebot("einzelunternehmen", "privat");
    expect(privat.directKinds.map((k) => k.value)).not.toContain("gebuehren");
    expect(privat.directKinds.map((k) => k.value)).not.toContain("zinsertrag");
    expect(privat.kategorien.length).toBeGreaterThan(0);
    expect(angebot("einzelunternehmen", "geschaeft").directKinds.length).toBe(
      privat.directKinds.length + AUCH_NUR_GESCHAEFT.length,
    );
  });
});
