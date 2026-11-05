/** Begründungen, die in mehreren Zeilen gleich lauten, mit ihrer Nummer: Sie stehen einmal unter der Tabelle statt in jeder Zeile */
export const sammelHinweise = (gruende: string[]): Map<string, number> => {
  const anzahl = new Map<string, number>();
  for (const grund of gruende) anzahl.set(grund, (anzahl.get(grund) ?? 0) + 1);
  const mehrfach = [...anzahl].filter(([, n]) => n > 1).map(([grund]) => grund);
  return new Map(mehrfach.map((grund, index) => [grund, index + 1]));
};
