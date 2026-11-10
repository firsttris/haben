-- Custom SQL migration file, put your code below! --
-- Herkunft und übernommene Zahlungsstände bleiben wie die Originalbelege nur anhängbar.
CREATE TRIGGER external_imports_append_only BEFORE UPDATE OR DELETE ON external_imports
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
-- Leere Test-/Einrichtungsbestände dürfen kaskadierend geleert werden, vorhandene Herkunft niemals.
CREATE FUNCTION haben_external_imports_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM external_imports) THEN
    RAISE EXCEPTION 'external_imports darf nur ergänzt werden';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER external_imports_no_truncate BEFORE TRUNCATE ON external_imports
  FOR EACH STATEMENT EXECUTE FUNCTION haben_external_imports_no_truncate();
--> statement-breakpoint
CREATE TRIGGER external_imports_audit AFTER INSERT ON external_imports
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
-- Importierte Originale dürfen untereinander dieselbe Angebotsnummer tragen. Eine neue native Nummer
-- kollidiert weiterhin mit JEDEM Bestand, auch bei gleichzeitiger Übernahme und Festschreibung.
CREATE FUNCTION haben_quote_number_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.number IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.number IS NOT DISTINCT FROM OLD.number
    AND NEW.external_source IS NOT DISTINCT FROM OLD.external_source THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('quote-original-number:' || NEW.number, 0));
  IF EXISTS (SELECT 1 FROM quotes q WHERE q.number = NEW.number AND q.id <> NEW.id
    AND (q.external_source IS NULL OR NEW.external_source IS NULL)) THEN
    RAISE EXCEPTION 'Angebotsnummer % ist bereits vergeben', NEW.number USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER quotes_number_origin BEFORE INSERT OR UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION haben_quote_number_origin();
