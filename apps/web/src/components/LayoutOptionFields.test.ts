import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { DEFAULT_DESIGN, type LetterheadDesign } from "@haben/core";
import { describe, expect, it, vi } from "vitest";
import { LayoutOptionFields } from "./LayoutOptionFields.tsx";

// Die Server-Funktion zum Speichern braucht die Umgebung der App; hier wird nur die Wahl geprüft
vi.mock("../server/functions/logo.ts", () => ({ saveLetterheadDesign: () => undefined }));

type SegmentedProps = { label: string; onChange: (wert: string) => void };

/** Die Segmented-Gruppen der Optionen aus dem Baum, ohne DOM */
function gruppen(node: ReactNode): SegmentedProps[] {
  const ergebnis: SegmentedProps[] = [];
  Children.forEach(node, (kind) => {
    if (!isValidElement(kind)) return;
    const props = (kind as ReactElement<{ children?: ReactNode } & Partial<SegmentedProps>>).props;
    if (typeof props.onChange === "function" && typeof props.label === "string") ergebnis.push(props as SegmentedProps);
    ergebnis.push(...gruppen(props.children));
  });
  return ergebnis;
}

function waehle(layoutId: string, layoutOptions: LetterheadDesign["layoutOptions"], option: string, wert: string) {
  const design = { ...DEFAULT_DESIGN, layoutOptions };
  let gesendet: LetterheadDesign["layoutOptions"] | undefined;
  const baum = LayoutOptionFields({ layoutId, design, onChange: (neu) => (gesendet = neu) });
  const gruppe = gruppen(baum).find((g) => g.label.startsWith(`${option} (`));
  if (!gruppe) throw new Error(`keine Gruppe ${option}`);
  gruppe.onChange(wert);
  return gesendet!;
}

describe("Optionen eines Layouts in der Gestaltung", () => {
  it("behält eine Wahl, die eine frühere Option sperrt, und setzt sie wieder, wenn die Sperre fällt (layout-katalog.ts)", () => {
    // Elegant, Fuß unten, Kerndaten zweispaltig; in der Randspalte gibt es nur die Liste
    const rechts = waehle("elegant", { elegant: { fuss: "unten", kerndaten: "zweispaltig" } }, "Fuß", "rechts");
    expect(rechts.elegant).toEqual({ fuss: "rechts", kerndaten: "zweispaltig" });
    const zurueck = waehle("elegant", rechts, "Fuß", "unten");
    expect(zurueck.elegant).toEqual({ fuss: "unten", kerndaten: "zweispaltig" });
  });

  it("Klar: die Karte bleibt gewählt über die Fassung „Klassisch“ hinweg", () => {
    const klassisch = waehle("klar", { klar: { fassung: "standard", kerndaten: "karte" } }, "Fassung", "klassisch");
    expect(klassisch.klar).toEqual({ fassung: "klassisch", kerndaten: "karte" });
  });
});
