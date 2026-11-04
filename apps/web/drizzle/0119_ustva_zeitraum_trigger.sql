-- Voranmeldungszeitraum: jede Änderung ins Audit-Log, damit nachvollziehbar bleibt, welcher Zeitraum wann eingestellt war
CREATE TRIGGER vat_frequencies_audit AFTER INSERT OR UPDATE OR DELETE ON vat_frequencies
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
