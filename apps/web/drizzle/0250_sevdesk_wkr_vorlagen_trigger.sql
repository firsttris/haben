-- Übernahme der sevDesk-Vorlagen wiederkehrender Rechnungen im Audit-Log, wie recurring_invoices (0018).
CREATE TRIGGER sevdesk_recurring_templates_audit AFTER INSERT OR UPDATE OR DELETE ON sevdesk_recurring_templates
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
