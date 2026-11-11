/** Änderungen dieser Verwaltungsfelder wählen keinen Umsatzsteuerstatus; unbekannte Änderungen bleiben erhalten. */
const unrelatedFields = new Set([
  "invoice_number_format",
  "quote_number_format",
  "invoice_counter_running",
  "quote_counter_running",
  "customer_number_format",
  "customer_number_next",
  "payment_plan_templates",
  "taxpayer",
  "elster_datenschutz_at",
  "datev_berater_nr",
  "datev_mandant_nr",
  "datev_personenkonten_ab",
  "journal_ab",
  "calendar_token_hash",
  "calendar_token_created_by",
  "calendar_token_responsible_id",
  "calendar_token_disabled_at",
  "calendar_token_disabled_reason",
  "mcp_enabled",
]);

/** Nur eindeutig fachfremde Änderungen auslassen, keine uneindeutige Speicherung ohne erkennbare Änderung. */
export function unrelatedCompanyAudit(row: { action: string; oldValue: unknown; newValue: unknown }): boolean {
  if (row.action !== "UPDATE" || !row.oldValue || !row.newValue) return false;
  const before = row.oldValue as Record<string, unknown>;
  const after = row.newValue as Record<string, unknown>;
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => key !== "updated_at" && JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
  return changed.length > 0 && changed.every((key) => unrelatedFields.has(key));
}
