-- Zugang zu Enable Banking: jede Änderung ins Audit-Log (haben_audit lässt den verschlüsselten Schlüssel weg)
CREATE TRIGGER enable_banking_settings_audit AFTER INSERT OR UPDATE OR DELETE ON enable_banking_settings
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
