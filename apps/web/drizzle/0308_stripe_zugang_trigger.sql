-- Zugang zu Stripe (Status, letzter Abruf, Stichtag): jede Änderung ins Protokoll, der Schlüssel (ciphertext) bleibt
-- draußen. Wie bei etsy_connections, bank_connections und store_connections gegen TRUNCATE gesperrt.

CREATE TRIGGER stripe_connections_audit AFTER INSERT OR UPDATE OR DELETE ON stripe_connections
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER stripe_connections_no_truncate BEFORE TRUNCATE ON stripe_connections
  FOR EACH STATEMENT EXECUTE FUNCTION haben_reject_truncate();
