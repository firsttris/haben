-- Angaben zu Körperschaft- und Gewerbesteuer bleiben änderbar, jede Änderung steht im Audit-Log.

CREATE TRIGGER corporate_tax_inputs_audit AFTER INSERT OR UPDATE OR DELETE ON corporate_tax_inputs
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
