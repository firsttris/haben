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

  it("löst ein Wort aus einer längeren Auszeichnung, auch wenn ein inneres Paar darüber reicht", () => {
    expect(toggle("*eins _[zwei] drei_*", "bold")).toBe("*eins* _zwei_ *_drei_*");
    expect(parseTextFormatting(toggle("*eins _zwei [drei]_ vier*", "bold")!).filter((run) => run.text.trim())).toEqual([
      { text: "eins", bold: true, italic: false, underline: false },
      { text: "zwei", bold: true, italic: true, underline: false },
      { text: "drei", bold: false, italic: true, underline: false },
      { text: "vier", bold: true, italic: false, underline: false },
    ]);
  });

  it("nimmt eine angeschnittene Auszeichnung am Auswahlrand ganz mit, statt sie zu überschreiben", () => {
    expect(toggleTextStyle("eins *zwei* _drei_", 0, 15, "italic")?.text).toBe("_eins_ *_zwei_* _drei_");
    expect(toggleTextStyle("_eins_ zwei", 2, 11, "bold")?.text).toBe("*_eins_* *zwei*");
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

  it("lässt Platzhalter ganz, auch wenn sie mit einem Schrägstrich zusammenhängen", () => {
    const november = { from: "2026-11-01", to: "2026-11-30" };
    expect(fillPlaceholders(toggle("Abrechnung {[monat]}/{jahr}", "bold")!, november)).toBe("Abrechnung *November/2026*");
    expect(fillPlaceholders(toggle("Abrechnung {monat}/{[jahr]}", "italic")!, november)).toBe("Abrechnung _November/2026_");
    expect(fillPlaceholders(toggle("Ablage [Kunde]/{jahr}", "underline")!, november)).toBe("Ablage __Kunde/2026__");
  });

  it("lässt den Platzhalter daneben ganz, wenn ein Wort aus einer längeren Auszeichnung gelöst wird", () => {
    const november = { from: "2026-11-01", to: "2026-11-30" };
    const fertig = (text: string) => plainFormattedText(fillPlaceholders(toggle(text, "bold") ?? "", november));
    expect(fertig("*Abrechnung {monat}-{[jahr]} und mehr*")).toBe("Abrechnung November-2026 und mehr");
    expect(fertig("*Abrechnung {[monat]}-{jahr} und mehr*")).toBe("Abrechnung November-2026 und mehr");
    expect(fertig("*Abrechnung [Zuschlag]-{jahr} und mehr*")).toBe("Abrechnung Zuschlag-2026 und mehr");
  });

  it("hält Wort und Platzhalter ohne Leerzeichen dazwischen zusammen, sonst stehen nach dem Ersetzen die Zeichen auf dem Beleg", () => {
    const november = { from: "2026-11-01", to: "2026-11-30" };
    const fertig = (text: string, style: TextStyle) => plainFormattedText(fillPlaceholders(toggle(text, style) ?? "", november));
    expect(fertig("[Wartung]{jahr}", "bold")).toBe("Wartung2026");
    expect(fertig("{monat}[{jahr}]", "italic")).toBe("November2026");
    expect(fertig("[{quartal}]{jahr} offen", "underline")).toBe("Q42026 offen");
    expect(fertig("{jahr}[Nachtrag] offen", "bold")).toBe("2026Nachtrag offen");
  });

  it("hält auch einen Punkt neben dem Platzhalter zusammen, sonst stehen nach dem Ersetzen die Zeichen auf dem Beleg", () => {
    const november = { from: "2026-11-01", to: "2026-11-30" };
    const fertig = (text: string, style: TextStyle) => plainFormattedText(fillPlaceholders(toggle(text, style) ?? "", november));
    expect(fertig("Abrechnung [{quartal}].{jahr}", "bold")).toBe("Abrechnung Q4.2026");
    expect(fertig("[Wartung].{jahr}", "italic")).toBe("Wartung.2026");
    expect(fertig("{jahr}.[Wartung] offen", "underline")).toBe("2026.Wartung offen");
  });

  it("nimmt ohne Auswahl den Platzhalter, wenn der Cursor direkt an ihm steht", () => {
    expect(toggle("Stand {jahr}[] netto", "bold")).toBe("Stand *{jahr}* netto");
    expect(toggle("Stand []{jahr} netto", "italic")).toBe("Stand _{jahr}_ netto");
  });

  it("hängt ohne Auswahl direkt an einer Auszeichnung keine losen Zeichen an, ein zweiter Druck stellt den Text wieder her", () => {
    const zweimal = (text: string, at: number, style: TextStyle) => {
      const erst = toggleTextStyle(text, at, at, style)!;
      expect(plainFormattedText(erst.text), erst.text).toBe(plainFormattedText(text));
      return toggleTextStyle(erst.text, erst.start, erst.end, style)?.text ?? null;
    };
    expect(zweimal("*Wort*", 6, "bold")).toBe("*Wort*");
    expect(zweimal("__Wort__ offen", 8, "underline")).toBe("__Wort__ offen");
    expect(zweimal("_Wort_ offen", 0, "italic")).toBe("_Wort_ offen");
  });

  it("zeichnet eine Zahl mit Dezimalkomma ohne Auswahl ganz aus", () => {
    expect(toggle("Preis 1.0[]00,50 € netto", "bold")).toBe("Preis *1.000,50* € netto");
    expect(toggle("Preis 1.000,5[]0 € netto", "bold")).toBe("Preis *1.000,50* € netto");
    expect(toggle("eins, zw[]ei", "bold")).toBe("eins, *zwei*");
  });

  it("nimmt ohne Auswahl beim leeren Paar die zweite Auszeichnung dazu statt die erste zu kürzen", () => {
    const nacheinander = (styles: TextStyle[]) =>
      styles.reduce(
        ({ text, start }, style) => {
          const edit = toggleTextStyle(text, start, start, style)!;
          return { text: edit.text, start: edit.start };
        },
        { text: "", start: 0 },
      );
    // Erst Strg+U, dann Strg+I, dann tippen: Wie bei der umgekehrten Reihenfolge ist das Wort beides
    const beides = nacheinander(["underline", "italic"]);
    const getippt = `${beides.text.slice(0, beides.start)}Wort${beides.text.slice(beides.start)}`;
    expect(parseTextFormatting(getippt)).toEqual([{ text: "Wort", bold: false, italic: true, underline: true }]);
    expect(nacheinander(["underline", "italic", "italic"]).text).toBe("____");
    expect(nacheinander(["italic", "underline", "underline"]).text).toBe("__");
    expect(nacheinander(["bold", "bold"]).text).toBe("");
  });

  it("nimmt ohne Auswahl auch die äußere von zwei leeren Auszeichnungen zurück", () => {
    const getippt = (styles: TextStyle[]) => {
      let [text, at] = ["", 0];
      for (const style of styles) {
        const edit = toggleTextStyle(text, at, at, style)!;
        [text, at] = [edit.text, edit.start];
      }
      return parseTextFormatting(`${text.slice(0, at)}Wort${text.slice(at)}`);
    };
    expect(getippt(["bold", "italic", "bold"])).toEqual([{ text: "Wort", bold: false, italic: true, underline: false }]);
    expect(getippt(["italic", "bold", "italic"])).toEqual([{ text: "Wort", bold: true, italic: false, underline: false }]);
    expect(getippt(["underline", "bold", "underline"])).toEqual([{ text: "Wort", bold: true, italic: false, underline: false }]);
    expect(getippt(["bold", "underline", "italic", "bold"])).toEqual([{ text: "Wort", bold: false, italic: true, underline: true }]);
  });

  it("unterstreicht das erste Wort einer kursiven Auszeichnung und umgekehrt", () => {
    const woerter = (text: string | null) => parseTextFormatting(text ?? "").filter((run) => run.text.trim());
    expect(woerter(toggle("_[eins] zwei_", "underline"))).toEqual([
      { text: "eins", bold: false, italic: true, underline: true },
      { text: "zwei", bold: false, italic: true, underline: false },
    ]);
    expect(woerter(toggle("__[eins] zwei__", "italic"))).toEqual([
      { text: "eins", bold: false, italic: true, underline: true },
      { text: "zwei", bold: false, italic: false, underline: true },
    ]);
  });

  it("nimmt die Auszeichnung für ein Wort auch neben einem Satzzeichen zurück", () => {
    const fett = (text: string | null) =>
      parseTextFormatting(text ?? "")
        .filter((run) => run.bold)
        .map((run) => run.text.trim());
    expect(fett(toggle("*eins [zwei], drei*", "bold"))).toEqual(["eins", "drei"]);
    expect(fett(toggle("*[eins], zwei*", "bold"))).toEqual(["zwei"]);
    expect(fett(toggle("*eins ([zwei]) drei*", "bold"))).toEqual(["eins", "drei"]);
    expect(fett(toggle("*IT-[Service] heute*", "bold"))).toEqual(["IT", "heute"]);
  });

  it("zeichnet ein Wort mit getrennt gespeichertem Umlaut ganz aus", () => {
    // So liefert macOS Text aus Dateinamen: u + U+0308 statt ü
    expect(toggle("Herr Mül[]ler kommt", "bold")).toBe("Herr *Müller* kommt");
    expect(toggle("Herr [Mu]̈ller kommt", "italic")).toBe("Herr _Müller_ kommt");
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
