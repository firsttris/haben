import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UstIdBestaetigung } from "../server/modules/stammdaten/index.ts";

vi.mock("../server/functions/ustid-bestaetigung.ts", () => ({ bestaetigeUstIdFn: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@tanstack/react-router", () => ({ Link: () => null, useRouter: () => ({ invalidate: vi.fn() }) }));
import { UstIdBestaetigungCard } from "./UstIdBestaetigungCard.tsx";

function antwort(art: "einfach" | "qualifiziert", zeitpunkt: string, erg: Partial<UstIdBestaetigung> = {}): UstIdBestaetigung {
  return {
    id: `${art}-${zeitpunkt}`,
    contactId: "c1",
    art,
    anfragendeUstid: "DE136695976",
    angefragteUstid: "ATU12345678",
    firmenname: art === "qualifiziert" ? "Donaublick GmbH" : null,
    strasse: null,
    plz: null,
    ort: art === "qualifiziert" ? "Wien" : null,
    status: "evatr-0000",
    anfrageZeitpunkt: new Date(zeitpunkt),
    gueltigAb: null,
    gueltigBis: null,
    ergFirmenname: null,
    ergStrasse: null,
    ergPlz: null,
    ergOrt: null,
    bzstId: null,
    antwort: "{}",
    createdBy: "test-user",
    createdAt: new Date(zeitpunkt),
    ...erg,
  };
}

/*
 * Befund 1 aus dem TDD-Review von #1569: Der monatliche Lauf legt eine einfache Antwort über die qualifizierte; der Abgleich
 * von Name und Anschrift soll trotzdem oben auf der Karte stehen, solange die Nummer gültig ist.
 */

describe("Bestätigung beim BZSt am Kontakt nach dem monatlichen Lauf (#1489)", () => {
  it("zeigt den Abgleich von Name und Ort der letzten qualifizierten Antwort weiter, wenn danach nur einfach bestätigt wurde", () => {
    // Neueste zuerst wie listUstIdBestaetigungen: der einfache Nachweis des Laufs, davor die Abfrage am Kontakt
    const bestaetigungen = [
      antwort("einfach", "2026-12-21T08:00:00+01:00", { createdBy: "system:ustid" }),
      antwort("qualifiziert", "2026-11-20T10:00:01+01:00", { ergFirmenname: "A", ergStrasse: "C", ergPlz: "C", ergOrt: "B" }),
      antwort("einfach", "2026-11-20T10:00:00+01:00"),
    ];
    const html = renderToStaticMarkup(
      createElement(UstIdBestaetigungCard, {
        contactId: "c1",
        ustId: "ATU12345678",
        bestaetigungen,
        zustand: { art: "bereit", faellig: false },
        nachSpeichern: false,
        onNachSpeichernErledigt: () => {},
      }),
    );
    expect(html).toContain("Stimmt nicht");
    // Der Abgleich stammt nicht aus der letzten Antwort: die Karte sagt, von wann er ist
    expect(html).toMatch(/Name und Anschrift zuletzt am 20\.11\.2026, 10:00/);
  });

  it("zeigt keinen Abgleich, wenn die letzte Antwort die Nummer nicht gültig nennt", () => {
    const bestaetigungen = [
      antwort("einfach", "2026-12-21T08:00:00+01:00", { status: "evatr-2006", createdBy: "system:ustid" }),
      antwort("qualifiziert", "2026-11-20T10:00:01+01:00", { ergFirmenname: "A", ergStrasse: "C", ergPlz: "C", ergOrt: "B" }),
    ];
    const html = renderToStaticMarkup(
      createElement(UstIdBestaetigungCard, {
        contactId: "c1",
        ustId: "ATU12345678",
        bestaetigungen,
        zustand: { art: "bereit", faellig: false },
        nachSpeichern: false,
        onNachSpeichernErledigt: () => {},
      }),
    );
    expect(html).not.toContain("Stimmt nicht");
    expect(html).not.toContain("Name und Anschrift zuletzt");
  });
});
