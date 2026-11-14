/**
 * Der Teil von Bun, den das Werkzeug nutzt. Nicht @types/bun in der Wurzel: Mit dem isolierten Linker sähen dann
 * auch die Typen anderer Pakete (unplugin importiert "bun") Bun und änderten fetch und ReadableStream für apps/web.
 * Quelle: bun-types 1.4.4, Bun.spawn und ImportMeta.main
 */
declare namespace Bun {
  interface Prozess {
    readonly stdout: ReadableStream<Uint8Array> | number | undefined;
    readonly stderr: ReadableStream<Uint8Array> | number | undefined;
    readonly exited: Promise<number>;
  }
  function spawn(
    befehl: string[],
    optionen: {
      cwd: string;
      env: Record<string, string>;
      stdin: "ignore" | Uint8Array;
      stdout: "pipe" | "inherit";
      stderr: "pipe" | "inherit";
    },
  ): Prozess;
}

interface ImportMeta {
  /** true, wenn diese Datei mit bun gestartet wurde und nicht importiert ist */
  readonly main: boolean;
}
