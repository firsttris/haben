-- Restlaufzeiten zum Jahresabschluss bleiben änderbar, jede Änderung steht im Audit-Log.

CREATE TRIGGER residual_terms_audit AFTER INSERT OR UPDATE OR DELETE ON residual_terms
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
