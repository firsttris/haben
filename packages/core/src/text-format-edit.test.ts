import { describe, expect, it } from "vitest";
import { fillPlaceholders } from "./recurring.ts";
import { parseTextFormatting, plainFormattedText, type TextStyle } from "./text-format.ts";
import { toggleTextStyle } from "./text-format-edit.ts";

/** Schreibweise wie im Feld: [ und ] markieren die Auswahl */
function auswahl(mitKlammern: string) {
  const start = mitKlammern.indexOf("[");
  const end = mitKlammern.indexOf("]") - 1;
  return { text: mitKlammern.replace("[", "").replace("]", ""), start, end };
}

const toggle = (mitKlammern: string, style: TextStyle) => {
  const { text, start, end } = auswahl(mitKlammern);
  return toggleTextStyle(text, start, end, style)?.text ?? null;
};

describe("Auszeichnung per Knopf", () => {
  it("setzt die drei Auszeichnungen um die Auswahl", () => {
    expect(toggle("Ein [Wort] hier", "bold")).toBe("Ein *Wort* hier");
    expect(toggle("Ein [Wort] hier", "italic")).toBe("Ein _Wort_ hier");
    expect(toggle("Ein [Wort] hier", "underline")).toBe("Ein __Wort__ hier");
  });

  it("nimmt sie beim zweiten Mal zurück, auch wenn die Auswahl die Zeichen enthält", () => {
    expect(toggle("Ein *[Wort]* hier", "bold")).toBe("Ein Wort hier");
    expect(toggle("Ein [*Wort*] hier", "bold")).toBe("Ein Wort hier");
    expect(toggle("Ein **[Wort]** hier", "bold")).toBe("Ein Wort hier");
    expect(toggle("Ein ___[Wort]___ hier", "italic")).toBe("Ein __Wort__ hier");
  });

  it("kombiniert Auszeichnungen in gültiger Reihenfolge", () => {
    expect(toggle("*[Wort]*", "italic")).toBe("*_Wort_*");
    expect(toggle("*[Wort]*", "underline")).toBe("*__Wort__*");
    expect(toggle("_[Wort]_", "underline")).toBe("___Wort___");
    expect(toggle("___[Wort]___", "bold")).toBe("*___Wort___*");
    expect(toggle("*___[Wort]___*", "underline")).toBe("*_Wort_*");
    expect(parseTextFormatting("*___Wort___*")).toEqual([{ text: "Wort", bold: true, italic: true, underline: true }]);
  });

  it("erweitert eine Auswahl auf ganze Wörter und lässt den Rand frei", () => {
    expect(toggle("Ein W[or]t hier", "bold")).toBe("Ein *Wort* hier");
    expect(toggle("Ein[ Wort ]hier", "bold")).toBe("Ein *Wort* hier");
    expect(toggle("datei[.z]ip", "bold")).toBe("*datei.zip*");
  });

  it("nimmt ohne Auswahl das Wort unter dem Cursor", () => {
    expect(toggle("Ein Wo[]rt hier", "bold")).toBe("Ein *Wort* hier");
  });

  it("setzt ohne Wort unter dem Cursor ein leeres Paar und nimmt es zurück", () => {
    const leer = toggleTextStyle("a  b", 2, 2, "bold");
    expect(leer).toEqual({ text: "a ** b", start: 3, end: 3 });
    expect(toggleTextStyle(leer!.text, leer!.start, leer!.end, "bold")).toEqual({ text: "a  b", start: 2, end: 2 });
  });

  it("fasst teilweise ausgezeichnete Auswahl zusammen und schaltet erst danach ab", () => {
    expect(toggle("[*fett* normal]", "bold")).toBe("*fett normal*");
    expect(toggle("[*fett normal*]", "bold")).toBe("fett normal");
    expect(parseTextFormatting(toggle("[*fett* und _kursiv_]", "bold")!).filter((run) => run.text.trim())).toEqual([
      { text: "fett und", bold: true, italic: false, underline: false },
      { text: "kursiv", bold: true, italic: true, underline: false },
    ]);
  });

  it("erhält die Unterstreichung, wenn die Auswahl mitten in den Zeichen beginnt", () => {
    expect(toggleTextStyle("__Wort__", 1, 7, "bold")?.text).toBe("*__Wort__*");
  });

  it("nimmt die Auszeichnung für ein Wort innerhalb einer längeren zurück", () => {
    expect(toggle("*eins [zwei]*", "bold")).toBe("*eins* zwei");
    expect(toggle("*[eins] zwei*", "bold")).toBe("eins *zwei*");
    expect(toggle("*eins [zwei] drei*", "bold")).toBe("*eins* zwei *drei*");
    expect(toggle("*eins zw[]ei*", "bold")).toBe("*eins* zwei");
  });

  it("behält beim Herauslösen die übrigen Auszeichnungen", () => {
    expect(toggle("___eins [zwei]___", "italic")).toBe("___eins___ __zwei__");
    expect(toggle("*_eins [zwei]_*", "bold")).toBe("*_eins_* _zwei_");
    expect(toggle("*eins _[zwei]_*", "bold")).toBe("*eins* _zwei_");
  });

  it("markiert nach dem Herauslösen das Wort ohne Zeichen", () => {
    expect(toggleTextStyle("*eins zwei*", 6, 10, "bold")).toEqual({ text: "*eins* zwei", start: 7, end: 11 });
  });

  it("zeichnet über mehrere Absätze aus", () => {
    expect(toggle("[eins\n\nzwei]", "bold")).toBe("*eins\n\nzwei*");
  });

  it("nimmt bei Pfaden das ganze Wort, weil Zeichen darin wörtlich bleiben", () => {
    expect(toggle(String.raw`Ablage C:\[Temp]\datei. Ende`, "bold")).toBe(String.raw`Ablage *C:\Temp\datei*. Ende`);
    expect(toggle("https://x.de/[a_b] Text", "bold")).toBe("*https://x.de/a_b* Text");
  });

  it("markiert danach den Text ohne die Zeichen", () => {
    expect(toggleTextStyle("Ein Wort", 4, 8, "bold")).toEqual({ text: "Ein *Wort*", start: 5, end: 9 });
  });

  it("verweigert, was der Parser nicht auszeichnen würde, statt Zeichen zu hinterlassen", () => {
    expect(toggle("x *a [b]", "bold")).toBeNull();
  });

  it("behandelt einen Platzhalter als ein Wort, sonst ersetzt ihn fillPlaceholders nicht mehr", () => {
    const november = { from: "2026-11-01", to: "2026-11-30" };
    // Doppelklick auf „monat“ markiert das Wort ohne die Klammern
    expect(fillPlaceholders(toggle("Wartung {[monat]} 2026", "bold")!, november)).toBe("Wartung *November* 2026");
    expect(fillPlaceholders(toggle("Wartung {mo[]nat} 2026", "italic")!, november)).toBe("Wartung _November_ 2026");
    expect(fillPlaceholders(toggle("[Wartung {mo]nat} 2026", "underline")!, november)).toBe("__Wartung November__ 2026");
  });

  it("nimmt Unterstrichen und Kursiv am Ende einer Auszeichnung beim zweiten Klick zurück", () => {
    const zweimal = (text: string, start: number, end: number, style: TextStyle) => {
      const erst = toggleTextStyle(text, start, end, style)!;
      return toggleTextStyle(erst.text, erst.start, erst.end, style)?.text ?? null;
    };
    expect(zweimal("_ein Wort_", 5, 9, "underline")).toBe("_ein Wort_");
    expect(zweimal("__ein Wort__", 6, 10, "italic")).toBe("__ein Wort__");
  });

  it("ändert nie den lesbaren Text, ganz gleich, was im Feld steht", () => {
    const zeichen = ["a", "b", " ", "\n", "*", "_", "\\", "/", ".", "(", "ä"];
    let zufall = 20260109;
    const naechste = (grenze: number) => {
      zufall = (zufall * 1103515245 + 12345) & 0x7fffffff;
      return zufall % grenze;
    };
    const styles: TextStyle[] = ["bold", "italic", "underline"];
    for (let lauf = 0; lauf < 5000; lauf++) {
      const text = Array.from({ length: naechste(14) + 1 }, () => zeichen[naechste(zeichen.length)]).join("");
      const a = naechste(text.length + 1);
      const b = naechste(text.length + 1);
      const ergebnis = toggleTextStyle(text, Math.min(a, b), Math.max(a, b), styles[naechste(3)]!);
      // Das leere Paar ohne Wort unter dem Cursor bleibt Eingabe und zählt nicht
      if (!ergebnis || a === b) continue;
      expect(plainFormattedText(ergebnis.text), JSON.stringify({ text, a, b })).toBe(plainFormattedText(text));
    }
  });
});
