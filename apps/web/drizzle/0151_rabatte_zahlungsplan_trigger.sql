-- Auswahl des Kunden bei optionalen und alternativen Positionen (quote_choices): nur zu einem festgeschriebenen, nicht
-- abgelehnten Angebot und nur Positionen, die optional oder eine Alternative sind. Fest, sobald eine Rechnung zum Angebot
-- festgeschrieben und nicht storniert ist: Rechnung, Abschläge und Auftragsbestätigung beruhen dann auf dieser Auswahl.
-- Zeilen werden nur angelegt oder gelöscht, nie geändert.
--
-- Rabatte und Zahlungsplan sind neue Spalten an invoices, invoice_lines, quotes und quote_lines; die bestehenden Sperren
-- (0003, 0044) vergleichen ganze Zeilen und schützen sie damit ab dem Festschreiben mit, und das Siegel einer Rechnung
-- nimmt sie über haben_columns beim Festschreiben auf. Ältere Siegel kennen die Spalten nicht und bleiben gültig.
CREATE FUNCTION haben_quote_choice_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  choice quote_choices := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Die Auswahl eines Angebots wird nicht geändert, nur angelegt oder gelöscht' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.quote_id = choice.quote_id AND i.status = 'final' AND i.kind = 'rechnung'
      AND NOT EXISTS (SELECT 1 FROM invoices s WHERE s.corrects_id = i.id AND s.kind = 'storno' AND s.status = 'final')
  ) THEN
    RAISE EXCEPTION 'Zu Angebot % ist eine Rechnung festgeschrieben; die Auswahl ist fest', choice.quote_id USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM quotes q WHERE q.id = NEW.quote_id AND q.status = 'final' AND q.decision IS DISTINCT FROM 'abgelehnt') THEN
      RAISE EXCEPTION 'Angebot % ist nicht festgeschrieben oder abgelehnt', NEW.quote_id USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM quote_lines l WHERE l.quote_id = NEW.quote_id AND l.position = NEW.position AND l.kind IS NOT NULL) THEN
      RAISE EXCEPTION 'Position % des Angebots ist weder optional noch Alternative', NEW.position USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER quote_choices_guard BEFORE INSERT OR UPDATE OR DELETE ON quote_choices
  FOR EACH ROW EXECUTE FUNCTION haben_quote_choice_guard();
--> statement-breakpoint
CREATE TRIGGER quote_choices_audit AFTER INSERT OR UPDATE OR DELETE ON quote_choices
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
