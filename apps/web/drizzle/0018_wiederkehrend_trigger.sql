-- Änderungen an Vorlagen für wiederkehrende Rechnungen protokollieren.

ALTER TABLE invoices ADD CONSTRAINT invoices_recurring_fk FOREIGN KEY (recurring_id) REFERENCES recurring_invoices(id);
--> statement-breakpoint
CREATE TRIGGER recurring_invoices_audit AFTER INSERT OR UPDATE OR DELETE ON recurring_invoices
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
