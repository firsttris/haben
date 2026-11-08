-- Entscheidung je Beleg über eine abweichende IBAN der E-Rechnung (#410): nur anhängbar wie sepa_transfer_items, jede
-- Zeile im Audit-Log. Sie ist auch an gebuchten, gesperrten Belegen möglich, ohne deren Sperre zu berühren.

SELECT set_config('haben.actor', 'system:migration', true);
--> statement-breakpoint
CREATE TRIGGER document_iban_decisions_append_only BEFORE UPDATE OR DELETE ON document_iban_decisions
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER document_iban_decisions_audit AFTER INSERT ON document_iban_decisions
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
