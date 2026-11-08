/**
 * deploy/eric-x86_64/einrichten.sh mit nachgebautem docker und QEMU: Der Pull des amd64-Images darf den lokalen Tag
 * der App nicht umbiegen, sonst startete die App auf arm64 danach das amd64-Image (#427).
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SKRIPT = resolve(import.meta.dirname, "../../../deploy/eric-x86_64/einrichten.sh");
const IMAGE = "tristanteu/haben:9.9.9";

/** docker-Ersatz: ein Tag als Datei, export liefert ein Wurzelverzeichnis mit Bun und worker.ts */
const FAKE_DOCKER = `#!/bin/sh
state="$FAKE_STATE"
case "$1" in
  image) [ -f "$state/tag" ] && cat "$state/tag" || exit 1 ;;
  pull) printf 'sha256:amd64' >"$state/tag" ;;
  create) echo c1 ;;
  export) tar -C "$state/rootfs" -c . ;;
  rm) ;;
  tag) printf '%s' "$2" >"$state/tag" ;;
  rmi) rm -f "$state/tag" ;;
  *) exit 2 ;;
esac
`;

const FAKE_QEMU = `#!/bin/sh
echo "qemu-x86_64 version 9.2.0"
`;

let dir: string;

function einrichten(): { status: number | null; stderr: string } {
  const result = spawnSync("sh", [SKRIPT, "9.9.9", join(dir, "ziel")], {
    env: { PATH: `${join(dir, "bin")}:/usr/bin:/bin`, FAKE_STATE: dir, QEMU: join(dir, "bin", "qemu-x86_64") },
    encoding: "utf8",
  });
  return { status: result.status, stderr: result.stderr };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "haben-einrichten-"));
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "docker"), FAKE_DOCKER);
  writeFileSync(join(dir, "bin", "qemu-x86_64"), FAKE_QEMU);
  chmodSync(join(dir, "bin", "docker"), 0o755);
  chmodSync(join(dir, "bin", "qemu-x86_64"), 0o755);
  const root = join(dir, "rootfs");
  mkdirSync(join(root, "usr/local/bin"), { recursive: true });
  mkdirSync(join(root, "app/packages/elster/src"), { recursive: true });
  writeFileSync(join(root, "usr/local/bin/bun"), "");
  chmodSync(join(root, "usr/local/bin/bun"), 0o755);
  writeFileSync(join(root, "app/packages/elster/src/worker.ts"), "");
  writeFileSync(join(root, "app/package.json"), '{\n  "version": "9.9.9",\n}\n');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe(`einrichten.sh (${IMAGE})`, () => {
  it("lässt den Tag auf dem Image der App, wenn es vorher schon da war", () => {
    writeFileSync(join(dir, "tag"), "sha256:arm64");

    const { status, stderr } = einrichten();

    expect(stderr).toBe("");
    expect(status).toBe(0);
    expect(readFileSync(join(dir, "tag"), "utf8")).toBe("sha256:arm64");
    expect(existsSync(join(dir, "ziel", "root", "app", "packages", "elster", "src", "worker.ts"))).toBe(true);
  });

  it("entfernt den Tag wieder, wenn es das Image vorher nicht gab", () => {
    const { status } = einrichten();

    expect(status).toBe(0);
    expect(existsSync(join(dir, "tag"))).toBe(false);
    expect(existsSync(join(dir, "ziel", "worker.sh"))).toBe(true);
  });
});
