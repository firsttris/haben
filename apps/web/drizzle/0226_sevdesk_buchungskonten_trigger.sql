-- Kontostamm aus sevDesk (#472): nur anhängbar, mit Ersteller im Audit-Log; ein neuer Stand kommt als neue Zeile.
CREATE TRIGGER sevdesk_accounting_types_append_only BEFORE UPDATE OR DELETE ON sevdesk_accounting_types
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER sevdesk_accounting_types_audit AFTER INSERT ON sevdesk_accounting_types
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER sevdesk_accounting_types_no_truncate BEFORE TRUNCATE ON sevdesk_accounting_types
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
