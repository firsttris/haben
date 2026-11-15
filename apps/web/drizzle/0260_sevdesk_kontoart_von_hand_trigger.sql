-- Kontoart von Hand (#888): nur anhängbar, mit Ersteller im Audit-Log; eine neue Entscheidung kommt als neue Zeile.
CREATE TRIGGER sevdesk_accounting_type_decisions_append_only BEFORE UPDATE OR DELETE ON sevdesk_accounting_type_decisions
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER sevdesk_accounting_type_decisions_audit AFTER INSERT ON sevdesk_accounting_type_decisions
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER sevdesk_accounting_type_decisions_no_truncate BEFORE TRUNCATE ON sevdesk_accounting_type_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
