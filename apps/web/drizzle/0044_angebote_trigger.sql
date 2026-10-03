-- Angebote: festgeschrieben unveränderlich; nur Entscheidung des Kunden und die erstellte Rechnung dürfen sich ändern.
CREATE FUNCTION haben_reject_locked_quote() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'decision' - 'decided_at' - 'invoice_id' - 'updated_at')
        IS DISTINCT FROM (to_jsonb(OLD) - 'decision' - 'decided_at' - 'invoice_id' - 'updated_at') THEN
      RAISE EXCEPTION 'Angebot % ist festgeschrieben und kann nicht geändert werden', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION haben_reject_locked_quote_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.quote_id ELSE NEW.quote_id END;
BEGIN
  IF EXISTS (SELECT 1 FROM quotes WHERE id = parent AND locked_at IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM quotes WHERE id = OLD.quote_id AND locked_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'Angebot % ist festgeschrieben, Positionen sind unveränderlich', parent
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER quotes_locked BEFORE UPDATE OR DELETE ON quotes
  FOR EACH ROW EXECUTE FUNCTION haben_reject_locked_quote();
--> statement-breakpoint
CREATE TRIGGER quote_lines_locked BEFORE INSERT OR UPDATE OR DELETE ON quote_lines
  FOR EACH ROW EXECUTE FUNCTION haben_reject_locked_quote_line();
--> statement-breakpoint
CREATE TRIGGER quote_number_counters_monotonic BEFORE UPDATE OR DELETE ON quote_number_counters
  FOR EACH ROW EXECUTE FUNCTION haben_counter_monotonic();
--> statement-breakpoint
CREATE TRIGGER quotes_audit AFTER INSERT OR UPDATE OR DELETE ON quotes
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER quote_number_counters_audit AFTER INSERT OR UPDATE ON quote_number_counters
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
