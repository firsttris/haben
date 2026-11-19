import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { deactivateCertificate, saveCertificate } from "../modules/elster/index.ts";
import { UserError } from "../errors.ts";
import { authMiddleware } from "../middleware.ts";

const MAX_SIZE = 64 * 1024;

const uploadSchema = z.object({
  file: z
    .instanceof(File)
    .refine((file) => file.size > 0 && file.size <= MAX_SIZE, "Die Datei muss zwischen 1 Byte und 64 KB groß sein.")
    .refine((file) => /\.pfx$/i.test(file.name), "Erwartet wird eine .pfx-Datei aus Mein ELSTER."),
  validUntil: z.union([z.literal(""), z.iso.date()]),
  /** Nur zum Lesen des Ablaufdatums aus der Datei, wird nicht gespeichert */
  pin: z.string().max(256),
});

export const uploadCertificate = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new UserError("FormData erwartet");
    return uploadSchema.parse({ file: data.get("file"), validUntil: data.get("validUntil") ?? "", pin: data.get("pin") ?? "" });
  })
  .handler(async ({ data, context }) => {
    const bytes = new Uint8Array(await data.file.arrayBuffer());
    return saveCertificate(context.user.id, { filename: data.file.name, bytes, validUntil: data.validUntil || null, pin: data.pin });
  });

export const removeCertificate = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await deactivateCertificate(context.user.id);
    return { ok: true };
  });
