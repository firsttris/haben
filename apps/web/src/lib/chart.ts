/** Achsenbeschriftung in vollen Euro */
export const euroAxis = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

/** Runde Achsenwerte in Cent, die min und max einschließen */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const range = Math.max(max - min, 100_00);
  const raw = range / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step / 2; v += step) ticks.push(v);
  return ticks;
}
