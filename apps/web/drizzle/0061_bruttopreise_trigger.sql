-- Netto und Umsatzsteuer je Steuersatz für alle bestehenden Rechnungen, so wie Haben sie bisher aus den
-- Positionen berechnet hat: Summe der Zeilennetto je Satz, Steuer darauf kaufmännisch gerundet
-- (round auf numeric rundet wie roundHalfAwayFromZero). Danach erst die Sperre anlegen.
INSERT INTO invoice_taxes (invoice_id, rate, base, tax)
SELECT invoice_id, tax_rate, sum(net), round(sum(net)::numeric * tax_rate / 10000)
  FROM invoice_lines
 GROUP BY invoice_id, tax_rate;
--> statement-breakpoint
-- Steuerzeilen festgeschriebener Rechnungen sind wie ihre Positionen unveränderlich
CREATE FUNCTION haben_reject_locked_invoice_tax() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  locked uuid;
BEGIN
  IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM invoices WHERE id = OLD.invoice_id AND locked_at IS NOT NULL) THEN
    locked := OLD.invoice_id;
  ELSIF TG_OP <> 'DELETE' AND EXISTS (SELECT 1 FROM invoices WHERE id = NEW.invoice_id AND locked_at IS NOT NULL) THEN
    locked := NEW.invoice_id;
  END IF;
  IF locked IS NOT NULL THEN
    RAISE EXCEPTION 'Rechnung % ist festgeschrieben, Steuerbeträge sind unveränderlich', locked USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invoice_taxes_locked BEFORE INSERT OR UPDATE OR DELETE ON invoice_taxes
  FOR EACH ROW EXECUTE FUNCTION haben_reject_locked_invoice_tax();
