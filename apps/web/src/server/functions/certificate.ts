import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { encrypt } from "../crypto.ts";
import { withActor } from "../db/actor.ts";
import { schema } from "../db/index.ts";
import { authMiddleware } from "../middleware.ts";

const MAX_SIZE = 64 * 1024;

const uploadSchema = z.object({
  file: z
    .instanceof(File)
    .refine((file) => file.size > 0 && file.size <= MAX_SIZE, "Die Datei muss zwischen 1 Byte und 64 KB groß sein.")
    .refine((file) => /\.pfx$/i.test(file.name), "Erwartet wird eine .pfx-Datei aus Mein ELSTER."),
  validUntil: z.union([z.literal(""), z.iso.date()]),
});

export const uploadCertificate = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new Error("FormData erwartet");
    return uploadSchema.parse({ file: data.get("file"), validUntil: data.get("validUntil") ?? "" });
  })
  .handler(async ({ data, context }) => {
    const bytes = new Uint8Array(await data.file.arrayBuffer());
    await withActor(context.user.id, async (tx) => {
      await tx
        .update(schema.elsterCertificates)
        .set({ active: false })
        .where(eq(schema.elsterCertificates.active, true));
      await tx.insert(schema.elsterCertificates).values({
        filename: data.file.name,
        ciphertext: encrypt(bytes),
        validUntil: data.validUntil || null,
      });
    });
    return { ok: true };
  });

export const removeCertificate = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await withActor(context.user.id, (tx) =>
      tx
        .update(schema.elsterCertificates)
        .set({ active: false })
        .where(eq(schema.elsterCertificates.active, true)),
    );
    return { ok: true };
  });
