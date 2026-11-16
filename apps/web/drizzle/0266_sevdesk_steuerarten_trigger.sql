-- Abgerufene Steuerarten bleiben unverändert; ein neuer Abruf ist eine neue Zeile.
CREATE TRIGGER sevdesk_tax_sets_append_only BEFORE UPDATE OR DELETE ON sevdesk_tax_sets
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER sevdesk_tax_sets_audit AFTER INSERT ON sevdesk_tax_sets
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER sevdesk_tax_sets_no_truncate BEFORE TRUNCATE ON sevdesk_tax_sets
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
