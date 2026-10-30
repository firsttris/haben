import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

describe("Verschlüsselung (Review)", () => {
  let crypto: typeof import("./crypto.ts");

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: "postgres://unused@localhost/unused",
      BETTER_AUTH_SECRET: "x".repeat(32),
      BETTER_AUTH_URL: "http://localhost:3000",
      HABEN_ENCRYPTION_KEY: process.env.HABEN_ENCRYPTION_KEY ?? randomBytes(32).toString("base64"),
    });
    crypto = await import("./crypto.ts");
  });

  it("lehnt ein Chiffrat mit gekürztem Authentifizierungs-Tag ab (GCM-Tag immer 16 Byte)", () => {
    const sealed = crypto.encrypt(new Uint8Array(0));
    // IV (12 Byte) und nur 4 der 16 Tag-Bytes: ein 32-Bit-Tag ließe sich mit 2^32 Versuchen fälschen
    const truncated = sealed.subarray(0, 12 + 4);
    expect(() => crypto.decrypt(truncated)).toThrow();
  });
});
