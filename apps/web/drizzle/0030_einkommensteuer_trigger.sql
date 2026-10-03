-- Angaben zur Einkommensteuererklärung bleiben änderbar, jede Änderung steht im Audit-Log.

CREATE TRIGGER income_tax_inputs_audit AFTER INSERT OR UPDATE OR DELETE ON income_tax_inputs
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
