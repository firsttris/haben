-- Lastschriftdateien (pain.008, #445): Datei und Lastschriften nur anhängbar wie sepa_transfers, jede Zeile im Audit-Log.

SELECT set_config('haben.actor', 'system:migration', true);
--> statement-breakpoint
CREATE TRIGGER sepa_direct_debits_append_only BEFORE UPDATE OR DELETE ON sepa_direct_debits
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER sepa_direct_debits_audit AFTER INSERT ON sepa_direct_debits
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER sepa_direct_debit_items_append_only BEFORE UPDATE OR DELETE ON sepa_direct_debit_items
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER sepa_direct_debit_items_audit AFTER INSERT ON sepa_direct_debit_items
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
