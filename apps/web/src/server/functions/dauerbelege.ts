import { EXPENSE_CATEGORIES } from "@haben/core";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { UserError } from "../errors.ts";
import { authMiddleware } from "../middleware.ts";
import {
  bookAndAllocateDauerbeleg,
  bookAndAllocateSchema,
  createDauerbeleg,
  DAUERBELEG_AKTIONEN,
  dauerbelegInputSchema,
  deleteDauerbeleg,
  getDauerbeleg,
  listDauerbelege,
  MAX_DOCUMENT_SIZE,
  runDueDauerbelege,
  setDauerbelegStatus,
  updateDauerbeleg,
} from "../modules/belege/index.ts";
import { listContacts, loadCompany } from "../modules/stammdaten/index.ts";
import { today } from "../today.ts";

const categoryOptions = Object.entries(EXPENSE_CATEGORIES)
  .filter(([value]) => value !== "anlage")
  .map(([value, { label }]) => ({ value, label }));

async function formContext() {
  const company = await loadCompany();
  return {
    suppliers: (await listContacts(false, "lieferant")).map(({ id, name, ustId }) => ({ id, name, ustId })),
    categories: categoryOptions,
    kleinunternehmer: company.kleinunternehmer,
    today: today(),
  };
}

export const getDauerbelegList = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => ({ items: await listDauerbelege(), categories: categoryOptions, today: today() }));

export const getDauerbelegForm = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(() => formContext());

export const getDauerbelegDetail = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data }) => {
    const result = await getDauerbeleg(data);
    if (!result) throw new UserError("Dauerbeleg nicht gefunden.");
    return { ...result, ...(await formContext()) };
  });

/** FormData: „vorlage“ als JSON, „id“ beim Ändern, „datei“ mit Vertrag oder Dauerrechnung (beim Anlegen Pflicht) */
export const saveDauerbeleg = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new UserError("FormData erwartet");
    const id = data.get("id") ? z.uuid().parse(data.get("id")) : null;
    let raw: unknown;
    try {
      raw = JSON.parse(String(data.get("vorlage") ?? ""));
    } catch {
      throw new UserError("Angaben fehlen.");
    }
    const vorlage = dauerbelegInputSchema.parse(raw);
    const file = data.get("datei");
    const datei = file instanceof File && file.size > 0 ? file : null;
    if (!id && !datei) throw new UserError("Vertrag oder Dauerrechnung fehlt. Ohne Dokument kein Beleg.");
    if (datei && datei.size > MAX_DOCUMENT_SIZE) throw new UserError(`${datei.name}: größer als 20 MB.`);
    return { id, vorlage, datei };
  })
  .handler(async ({ data, context }) => {
    const file = data.datei ? { bytes: new Uint8Array(await data.datei.arrayBuffer()), filename: data.datei.name } : null;
    const saved = data.id ? await updateDauerbeleg(context.user.id, data.id, data.vorlage, file) : await createDauerbeleg(context.user.id, data.vorlage, file!);
    return { id: saved.id };
  });

export const changeDauerbelegStatus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.uuid(), aktion: z.enum(DAUERBELEG_AKTIONEN) }))
  .handler(async ({ data, context }) => {
    await setDauerbelegStatus(context.user.id, data.id, data.aktion, today());
    return { ok: true };
  });

export const removeDauerbeleg = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.uuid())
  .handler(async ({ data, context }) => {
    await deleteDauerbeleg(context.user.id, data);
    return { ok: true };
  });

/** Fällige Termine sofort anlegen, statt auf den stündlichen Lauf zu warten */
export const runDauerbelegeNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(() => runDueDauerbelege(today()));

/** Bankabgleich: Beleg aus einem Dauerbeleg buchen und dem Umsatz zuordnen */
export const bookAndAllocateDauerbelegFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(bookAndAllocateSchema)
  .handler(async ({ data, context }) => {
    await bookAndAllocateDauerbeleg(context.user.id, data);
    return { ok: true };
  });
