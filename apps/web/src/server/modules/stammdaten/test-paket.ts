import { gzipSync } from "node:zlib";
import type { LayoutPackage, PackageFetcher } from "./paket-download.ts";

/** Tests: tar.gz-Archive wie in Typst Universe, gebaut im Speicher */

/** Ein Eintrag im ustar-Format, mit Prüfsumme wie bei tar */
export function tarEintrag(name: string, data: Buffer | string, type = "0"): Buffer {
  const body = Buffer.from(data);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100);
  header.write("0000000\0", 108);
  header.write("0000000\0", 116);
  header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
  header.write("00000000000\0", 136);
  header.write("        ", 148);
  header.write(type, 156);
  header.write("ustar\u000000", 257);
  const sum = header.reduce((s, b) => s + b, 0);
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return Buffer.concat([header, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
}

export const tarGz = (...teile: Buffer[]) => gzipSync(Buffer.concat([...teile, Buffer.alloc(1024)]));

/** Ein Paket @preview/<name> mit typst.toml und lib.typ */
export function paketArchiv(name: string, version: string, lib: string, extra: Buffer[] = []): Buffer {
  const toml = `[package]\nname = "${name}"\nversion = "${version}"\nentrypoint = "lib.typ"\nauthors = ["Test"]\nlicense = "MIT"\ndescription = "Test"\n`;
  return tarGz(tarEintrag("./", "", "5"), tarEintrag("./typst.toml", toml), tarEintrag("./lib.typ", lib), ...extra);
}

/** Holt Archive aus einer Tabelle „@preview/x:1.0.0“ → Archiv; merkt sich jeden Abruf */
export function fakeUniverse(archive: Record<string, Buffer>): PackageFetcher & { abrufe: string[] } {
  const abrufe: string[] = [];
  const fetcher = async (pkg: LayoutPackage) => {
    const spec = `${pkg.name}:${pkg.version}`;
    abrufe.push(spec);
    const archiv = archive[spec];
    if (!archiv) throw new Error(`kein Archiv für ${spec}`);
    return archiv;
  };
  return Object.assign(fetcher, { abrufe });
}
