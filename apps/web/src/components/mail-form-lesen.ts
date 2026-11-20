import type { MailTemplates } from "@haben/core";
import { MAX_PEM_SIZE } from "./MailGraphFields.tsx";
import type { SmtpServer } from "./MailSmtpFields.tsx";

/* Liest das Formular des E-Mail-Versands (MailCard.tsx) zu den Daten für saveMail. Ohne React, damit es sich für sich prüfen lässt. */

/** Was MailCard außerhalb der Formularfelder hält: Versandweg, Anmeldung bei Microsoft 365, SMTP-Server, Tage und Vorlagen */
export type MailState = { transport: "smtp" | "graph"; graphAuth: "secret" | "certificate"; server: SmtpServer; days: number[]; templates: MailTemplates };

/** Eingaben des Formulars für saveMail; Zertifikat und Schlüssel liest es aus den gewählten Dateien */
export async function mailInput(form: FormData, { transport, graphAuth, server, days, templates }: MailState) {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const common = {
    fromAddress: text("fromAddress"),
    fromName: text("fromName"),
    reminderTo: text("reminderTo"),
    remindersEnabled: form.get("remindersEnabled") === "on",
    reminderDays: days,
    templates,
    pruefwertMail: form.get("pruefwertMail") === "on",
  };
  if (transport === "smtp") {
    const { host, port, secure } = server;
    return { transport, host, port: Number(port), secure, username: text("username"), password: text("password") || undefined, ...common };
  }
  const pem = async (name: string) => {
    const file = form.get(name);
    if (!(file instanceof File) || file.size === 0) return undefined;
    if (file.size > MAX_PEM_SIZE) throw new Error("Die Datei ist zu groß für ein Zertifikat oder einen Schlüssel.");
    return file.text();
  };
  return {
    transport,
    graphTenantId: text("graphTenantId"),
    graphClientId: text("graphClientId"),
    graphAuth,
    graphMailbox: text("graphMailbox"),
    clientSecret: graphAuth === "secret" ? text("clientSecret") || undefined : undefined,
    certificatePem: graphAuth === "certificate" ? await pem("certificate") : undefined,
    privateKeyPem: graphAuth === "certificate" ? await pem("privateKey") : undefined,
    ...common,
  };
}
