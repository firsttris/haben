-- Abrechenbare Leistungen (#417): Ein Eintrag, der auf einer festgeschriebenen und nicht stornierten Rechnung steht, ist
-- unveränderlich und nicht löschbar: Dauer, Satz, Kunde, Tag, Text und die Verknüpfung selbst. Auf einem Entwurf ist er
-- noch änderbar (die Anwendung verlangt dort erst, den Entwurf zu löschen). Nach dem Storno der Rechnung ist er wieder
-- frei, wie bei Angeboten (syncQuoteBilling); die Stornorechnung ist eine festgeschriebene mit corrects_id.

CREATE FUNCTION haben_reject_billed_service_entry() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  aktiv boolean;
BEGIN
  IF OLD.invoice_id IS NOT NULL THEN
    SELECT i.locked_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM invoices s WHERE s.kind = 'storno' AND s.status = 'final' AND s.corrects_id = i.id)
      INTO aktiv
      FROM invoices i WHERE i.id = OLD.invoice_id;
    IF COALESCE(aktiv, false) THEN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Leistung % ist auf einer festgeschriebenen Rechnung abgerechnet und lässt sich nicht löschen', OLD.id
          USING ERRCODE = 'check_violation';
      END IF;
      IF (NEW.contact_id, NEW.worked_on, NEW.minutes, NEW.billable_minutes, NEW.hourly_rate_cents, NEW.non_billable, NEW.description, NEW.project, NEW.invoice_id, NEW.external_source, NEW.external_id)
         IS DISTINCT FROM
         (OLD.contact_id, OLD.worked_on, OLD.minutes, OLD.billable_minutes, OLD.hourly_rate_cents, OLD.non_billable, OLD.description, OLD.project, OLD.invoice_id, OLD.external_source, OLD.external_id) THEN
        RAISE EXCEPTION 'Leistung % ist auf einer festgeschriebenen Rechnung abgerechnet und unveränderlich', OLD.id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER service_entries_billed BEFORE UPDATE OR DELETE ON service_entries
  FOR EACH ROW EXECUTE FUNCTION haben_reject_billed_service_entry();
