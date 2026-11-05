/** Begründungen, die in mehreren Zeilen gleich lauten, mit ihrer Nummer: Sie stehen einmal unter der Tabelle statt in jeder Zeile */
export const sammelHinweise = (gruende: string[]): Map<string, number> => {
  const anzahl = new Map<string, number>();
  for (const grund of gruende) anzahl.set(grund, (anzahl.get(grund) ?? 0) + 1);
  const mehrfach = [...anzahl].filter(([, n]) => n > 1).map(([grund]) => grund);
  return new Map(mehrfach.map((grund, index) => [grund, index + 1]));
};

/** Hinweise zweier Erklärungen aufteilen: was in beiden gleich lautet, steht einmal über beiden statt in jeder */
export const teileHinweise = <T extends { text: string }>(a: T[], b: T[]): { gemeinsam: T[]; nurA: T[]; nurB: T[] } => {
  const inB = new Set(b.map((h) => h.text));
  const gemeinsam = a.filter((h) => inB.has(h.text));
  const texte = new Set(gemeinsam.map((h) => h.text));
  return { gemeinsam, nurA: a.filter((h) => !texte.has(h.text)), nurB: b.filter((h) => !texte.has(h.text)) };
};
