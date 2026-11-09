-- SEPA-Lastschriftmandate (#445): Mandat, PDF und Widerruf sind nur anhängbar wie document_iban_decisions, jede Zeile
-- im Audit-Log. Ein geändertes Mandat ist ein neues Mandat mit eigener Referenz; die Historie bleibt vollständig.

SELECT set_config('haben.actor', 'system:migration', true);
--> statement-breakpoint
CREATE TRIGGER sepa_mandates_append_only BEFORE UPDATE OR DELETE ON sepa_mandates
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER sepa_mandates_audit AFTER INSERT ON sepa_mandates
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER sepa_mandate_files_append_only BEFORE UPDATE OR DELETE ON sepa_mandate_files
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER sepa_mandate_files_audit AFTER INSERT ON sepa_mandate_files
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER sepa_mandate_revocations_append_only BEFORE UPDATE OR DELETE ON sepa_mandate_revocations
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER sepa_mandate_revocations_audit AFTER INSERT ON sepa_mandate_revocations
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
