-- Bareinnahme auf eine Ausgangsrechnung im Kassenbuch: nur auf eine festgeschriebene Rechnung, wie die Zuordnung eines
-- Bankumsatzes. Die Zeile selbst ist wie jede im Kassenbuch nur anhängbar, im Audit-Log und gesiegelt (0056, 0064); ihre
-- neuen Spalten nimmt das Siegel über haben_columns('cash_entries') beim Einfügen mit auf.
CREATE FUNCTION haben_cash_entry_invoice() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM invoices WHERE id = NEW.invoice_id AND status = 'final') THEN
    RAISE EXCEPTION 'Bareinnahme auf Rechnung %, die nicht festgeschrieben ist', NEW.invoice_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER cash_entries_invoice BEFORE INSERT ON cash_entries
  FOR EACH ROW WHEN (NEW.invoice_id IS NOT NULL) EXECUTE FUNCTION haben_cash_entry_invoice();
