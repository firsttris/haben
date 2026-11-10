-- Eine externe API-/Shop-Referenz macht eine in Haben ausgestellte Rechnung nicht zum Originalimport.
-- Native Festschreibungen setzen number_counter; übernommene Originale verbrauchen keinen Zähler.
CREATE OR REPLACE FUNCTION haben_invoice_number_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.number IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.number IS NOT DISTINCT FROM OLD.number
    AND NEW.external_source IS NOT DISTINCT FROM OLD.external_source
    AND NEW.number_counter IS NOT DISTINCT FROM OLD.number_counter THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('invoice-original-number:' || NEW.number, 0));
  IF EXISTS (SELECT 1 FROM invoices i WHERE i.number = NEW.number AND i.id <> NEW.id
    AND (i.external_source IS NULL OR i.number_counter IS NOT NULL
      OR NEW.external_source IS NULL OR NEW.number_counter IS NOT NULL)) THEN
    RAISE EXCEPTION 'Rechnungsnummer % ist bereits vergeben', NEW.number USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
