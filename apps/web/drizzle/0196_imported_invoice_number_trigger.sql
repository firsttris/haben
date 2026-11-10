-- Custom SQL migration file, put your code below! --
-- Quellnummern verschiedener Originale erhalten, native Neuausstellung weiterhin eindeutig.
CREATE FUNCTION haben_invoice_number_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.number IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.number IS NOT DISTINCT FROM OLD.number
    AND NEW.external_source IS NOT DISTINCT FROM OLD.external_source THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('invoice-original-number:' || NEW.number, 0));
  IF EXISTS (SELECT 1 FROM invoices i WHERE i.number = NEW.number AND i.id <> NEW.id
    AND (i.external_source IS NULL OR NEW.external_source IS NULL)) THEN
    RAISE EXCEPTION 'Rechnungsnummer % ist bereits vergeben', NEW.number USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoices_number_origin BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION haben_invoice_number_origin();
