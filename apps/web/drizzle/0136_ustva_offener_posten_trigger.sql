-- Voranmeldung als offener Posten. Der Abgabevermerk einer außerhalb von Haben abgegebenen Voranmeldung ist wie die
-- Übermittlungen nur anhängbar und steht im Audit-Log; das Protokoll-PDF liegt im Dokumentenspeicher unter seinem
-- SHA-256. Ein Vermerk gilt nur zusammen mit der Festschreibung der Anmeldung in derselben Transaktion (geprüft beim
-- Commit), eine Zahlung mit Bezug nur auf eine abgegebene Voranmeldung.

CREATE TRIGGER vat_return_filings_append_only BEFORE UPDATE OR DELETE ON vat_return_filings
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER vat_return_filings_audit AFTER INSERT ON vat_return_filings
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE FUNCTION haben_vat_return_filed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vat_returns WHERE id = NEW.vat_return_id AND status = 'sent' AND locked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Abgabevermerk % ohne festgeschriebene Voranmeldung', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER vat_return_filings_sent AFTER INSERT ON vat_return_filings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION haben_vat_return_filed();
--> statement-breakpoint
CREATE FUNCTION haben_allocation_vat_return() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vat_returns WHERE id = NEW.vat_return_id AND status = 'sent') THEN
    RAISE EXCEPTION 'Zahlung zur Voranmeldung %, die nicht abgegeben ist', NEW.vat_return_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER allocations_vat_return BEFORE INSERT ON allocations
  FOR EACH ROW WHEN (NEW.vat_return_id IS NOT NULL) EXECUTE FUNCTION haben_allocation_vat_return();
