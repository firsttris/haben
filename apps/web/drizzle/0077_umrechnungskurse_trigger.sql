-- Abgerufene und von Hand eingetragene Kurse: jede Änderung ins Audit-Log, damit nachvollziehbar bleibt, welcher Kurs wann galt
CREATE TRIGGER exchange_rates_audit AFTER INSERT OR UPDATE OR DELETE ON exchange_rates
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
-- Ungebuchte Belege mit Kurs aus der Zeit, als es nur den Kurs von Hand gab
UPDATE documents SET exchange_rate_source = 'manuell' WHERE exchange_rate IS NOT NULL AND exchange_rate_source IS NULL AND locked_at IS NULL;
