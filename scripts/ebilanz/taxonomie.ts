/**
 * Auszug aus der HGB-Taxonomie (de-gaap-ci) für die E-Bilanz einer Kapitalgesellschaft: je Position von Bilanz, GuV
 * (Gesamtkostenverfahren) und steuerlichem Betriebsvermögensvergleich (BVV) der steuerliche Pflichtgrad, die Summenbeziehung, Soll/Haben und der Periodentyp. Bezeichnungen
 * übernimmt der Auszug nicht; er enthält nur, was die Übermittlung braucht.
 *
 * Quelle: www.esteuer.de, german-gaap-taxonomy-v6.9-2025-04-01-xbrl.zip und germany-gaap-taxonomy-v6.10-2026-04-01-xbrl.zip.
 * Aufruf mit dem entpackten Ordner:
 *   bun scripts/ebilanz/taxonomie.ts <Ordner>/de-gaap-ci-2025-04-01 packages/elster/src/ebilanz/taxonomie-6-9.json
 *   bun scripts/ebilanz/taxonomie.ts <Ordner>/de-gaap-ci-2026-04-01 packages/elster/src/ebilanz/taxonomie-6-10.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, out] = process.argv.slice(2);
if (!dir || !out) throw new Error("Aufruf: bun scripts/ebilanz/taxonomie.ts <de-gaap-ci-Ordner> <Ausgabe.json>");
const base = dir.replace(/\/+$/, "").split("/").at(-1)!;
const read = (suffix: string) => readFileSync(join(dir, `${base}${suffix}`), "utf8");
const PREFIX = "de-gaap-ci_";

/** Pflichtgrad: M Mussfeld, S Summenmussfeld, R rechnerisch notwendig, "" frei */
const REQ: Record<string, string> = { Mussfeld: "M", Summenmussfeld: "S", "Rechnerisch notwendig, soweit vorhanden": "R" };

const reference = read("-reference-fiscal.xml");
const fiscal = new Map<string, { req: string; kst: boolean; forbidden: boolean; ukv: boolean }>();
for (const m of reference.matchAll(/<reference [^>]*id="reference_(de-gaap-ci_[^"]+)">([\s\S]*?)<\/reference>/g)) {
  const body = m[2]!;
  const field = (name: string) => new RegExp(`<hgbref:${name}>([^<]*)</hgbref:${name}>`).exec(body)?.[1] ?? "";
  fiscal.set(m[1]!.slice(PREFIX.length), {
    req: REQ[field("fiscalRequirement")] ?? "",
    kst: field("legalFormKSt") === "true",
    forbidden: /steuerlich/.test(field("notPermittedFor")),
    ukv: field("typeOperatingResult") === "UKV",
  });
}

const schema = read(".xsd");
const elements = new Map<string, { balance: string; period: string; monetary: boolean }>();
for (const m of schema.matchAll(/<xs:element\b([^>]*)>/g)) {
  const attrs = m[1]!;
  const name = /\bname="([^"]+)"/.exec(attrs)?.[1];
  if (!name) continue;
  elements.set(name, {
    balance: /xbrli:balance="(\w+)"/.exec(attrs)?.[1] ?? "",
    period: /xbrli:periodType="(\w+)"/.exec(attrs)?.[1] ?? "",
    monetary: /type="xbrli:monetaryItemType"/.test(attrs),
  });
}

/** Summenbeziehungen (summation-item) aus der Rechenlogik von Bilanz und GuV */
const parent = new Map<string, { parent: string; weight: number; order: number }>();
for (const file of ["-calculation-balanceSheet.xml", "-calculation-incomeStatement.xml", "-calculation-transfersTaxAssets.xml"]) {
  for (const m of read(file).matchAll(/<calculationArc\b([^>]*)\/?>/g)) {
    const a = m[1]!;
    const from = /xlink:from="de-gaap-ci_([^"]+)"/.exec(a)?.[1];
    const to = /xlink:to="de-gaap-ci_([^"]+)"/.exec(a)?.[1];
    if (!from || !to || parent.has(to)) continue;
    parent.set(to, { parent: from, weight: Number(/weight="([-\d.]+)"/.exec(a)?.[1] ?? 1), order: Number(/order="([\d.]+)"/.exec(a)?.[1] ?? 0) });
  }
}

const positions: Record<string, [req: string, parent: string | null, weight: number, balance: string, period: string]> = {};
for (const [name, f] of fiscal) {
  if (!(name.startsWith("bs.") || name.startsWith("is.netIncome") || name.startsWith("BVV.")) || !f.kst || f.forbidden || f.ukv) continue;
  const e = elements.get(name);
  if (!e?.monetary) continue;
  const p = parent.get(name);
  positions[name] = [f.req, p?.parent ?? null, p?.weight ?? 1, e.balance, e.period];
}
writeFileSync(out, `${JSON.stringify({ taxonomie: base, positionen: positions })}\n`);
console.log(`${Object.keys(positions).length} Positionen nach ${out}`);
