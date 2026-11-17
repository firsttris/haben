/*
 * lib-fints 1.5.3 schreibt eine Antwort der Bank, die es nicht dekodieren kann, mit console.error ganz ins Log, auch mit
 * debugEnabled = false (dist/httpClient.js, sendMessage: „Response Message Content:“). Darin stehen Umsätze, Namen, IBANs,
 * BPD und UPD; ein Log landet schnell in einem Issue oder bei einem Log-Dienst. Haben lässt den Inhalt weg und behält
 * die Zeile davor mit dem Fehler von lib-fints. Die Datei fällt weg, sobald lib-fints das nur noch im Debug-Log schreibt.
 */

/** Erstes Argument, mit dem lib-fints den Inhalt der Antwort ins Log schreibt */
const ANTWORT_IM_LOG = "Response Message Content:\n";

/** Die Filter, die schon an console.error hängen; ersetzt jemand console.error, filtert der nächste Client neu */
const gefiltert = new WeakSet<typeof console.error>();

/** console.error ohne den Inhalt unlesbarer Antworten */
export function bankdatenNichtLoggen(): void {
  const log = console.error;
  if (gefiltert.has(log)) return;
  const filter = (...args: unknown[]) => {
    if (args[0] === ANTWORT_IM_LOG) log("FinTS: Inhalt der unlesbaren Antwort der Bank nicht ins Log geschrieben (Bankdaten).");
    else log(...args);
  };
  gefiltert.add(filter);
  console.error = filter;
}
