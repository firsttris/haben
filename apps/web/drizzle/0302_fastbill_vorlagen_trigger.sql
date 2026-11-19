-- Übernahme der FastBill-Vorlagen wiederkehrender Rechnungen im Audit-Log, wie sevdesk_recurring_templates (0252).
CREATE TRIGGER fastbill_recurring_templates_audit AFTER INSERT OR UPDATE OR DELETE ON fastbill_recurring_templates
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
-- TRUNCATE ginge am Audit-Log vorbei (0201)
CREATE TRIGGER fastbill_recurring_templates_no_truncate BEFORE TRUNCATE ON fastbill_recurring_templates
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
