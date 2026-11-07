-- Abrufnachweise bleiben unverändert, auch fehlgeschlagene Nachkontrollen.
CREATE TRIGGER legacy_order_pdf_attempts_append_only BEFORE UPDATE OR DELETE ON legacy_order_pdf_attempts
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER legacy_order_pdf_attempts_audit AFTER INSERT ON legacy_order_pdf_attempts
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
