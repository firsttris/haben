-- Übernahme der sevDesk-Vorlagen wiederkehrender Rechnungen im Audit-Log, wie recurring_invoices (0018).
CREATE TRIGGER sevdesk_recurring_templates_audit AFTER INSERT OR UPDATE OR DELETE ON sevdesk_recurring_templates
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
-- TRUNCATE ginge am Audit-Log vorbei (0201)
CREATE TRIGGER sevdesk_recurring_templates_no_truncate BEFORE TRUNCATE ON sevdesk_recurring_templates
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
