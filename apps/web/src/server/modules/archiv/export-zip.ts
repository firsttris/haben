import { createHash } from "node:crypto";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";

// ZIP-Stream des Jahresarchivs mit Prüfsummen

const encoder = new TextEncoder();

export interface ArchiveFile {
  path: string;
  content: Uint8Array | AsyncIterable<Uint8Array>;
  /** PDFs und Fotos sind schon komprimiert und werden nur gespeichert */
  compress: boolean;
}

export const CHECKSUM_FILE = "pruefsummen.sha256";

/**
 * Packt die Dateien nacheinander ins ZIP und liefert die fertigen Bytes stückweise.
 * Zum Schluss kommt pruefsummen.sha256 im Format von `sha256sum` dazu.
 */
export async function* zipArchive(files: AsyncIterable<ArchiveFile>, mtime: Date): AsyncGenerator<Uint8Array> {
  const queue: Uint8Array[] = [];
  let failure: Error | null = null;
  let written = 0;
  let entries = 0;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else if (chunk.length > 0) {
      written += chunk.length;
      queue.push(chunk);
    }
  });
  function* drain(): Generator<Uint8Array> {
    if (failure) throw failure;
    while (queue.length > 0) yield queue.shift()!;
  }

  const checksums: string[] = [];
  const add = async function* (file: ArchiveFile): AsyncGenerator<Uint8Array> {
    // fflate kennt kein ZIP64: lieber abbrechen als ein still kaputtes Archiv ausliefern
    if (++entries > 0xffff || written >= 0xffffffff)
      throw new Error("Das Jahresarchiv überschreitet 4 GB oder 65.535 Dateien; das kann das ZIP-Format ohne ZIP64 nicht.");
    const entry = file.compress ? new ZipDeflate(file.path, { level: 6 }) : new ZipPassThrough(file.path);
    entry.mtime = mtime;
    zip.add(entry);
    const hash = createHash("sha256");
    if (file.content instanceof Uint8Array) {
      hash.update(file.content);
      entry.push(file.content, true);
    } else {
      for await (const chunk of file.content) {
        hash.update(chunk);
        entry.push(chunk, false);
        yield* drain();
      }
      entry.push(new Uint8Array(0), true);
    }
    checksums.push(`${hash.digest("hex")}  ${file.path}`);
    yield* drain();
  };

  for await (const file of files) yield* add(file);
  yield* add({ path: CHECKSUM_FILE, content: encoder.encode(`${checksums.join("\n")}\n`), compress: true });
  if (written >= 0xffffffff) throw new Error("Das Jahresarchiv überschreitet 4 GB; das kann das ZIP-Format ohne ZIP64 nicht.");
  zip.end();
  yield* drain();
}

export function toReadableStream(chunks: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const { value, done } = await chunks.next();
          if (done) controller.close();
          else controller.enqueue(value);
        } catch (error) {
          console.error("Jahresarchiv abgebrochen", error);
          controller.error(error);
        }
      },
      async cancel() {
        await chunks.return(undefined);
      },
    },
    { highWaterMark: 1 },
  );
}
