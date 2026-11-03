-- Jahresabschluss (#213): Ein abgeschlossenes Jahr nimmt keine Buchung mehr an. Beim Abschluss hält die Datenbank Zahl und
-- Prüfwert der Buchungen des Jahres fest: SHA-256 über ID und Inhalt jeder Buchung samt Zeilen, wie ihr Siegel ihn rechnet
-- (haben_seal_digest aus 0063/0064, mit den Spalten des Siegels), in der Reihenfolge Datum, ID. Gerechnet wird aus den
-- aktuellen Daten, nicht aus den gespeicherten Siegeln: Ändert jemand danach eine Buchung an Haben vorbei, passt der
-- Prüfwert nicht mehr (Seite Jahresabschluss).
-- Abschluss und Buchung nehmen beide zuerst die Sperre der Hash-Kette (0063, 0065): Eine Buchung, die gleichzeitig läuft,
-- ist entweder vor dem Abschluss festgeschrieben und zählt mit, oder sie sieht den Abschluss und wird abgelehnt.

SELECT set_config('haben.actor', 'system:migration', true);
--> statement-breakpoint
CREATE FUNCTION haben_year_digest(y integer, OUT entries integer, OUT digest text)
LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer,
         encode(sha256(convert_to(coalesce(string_agg(
           e.id::text || ':' || haben_seal_digest('journal_entries', e.id, coalesce(s.columns, haben_seal_columns('journal_entries'))),
           ',' ORDER BY e.date, e.id), ''), 'UTF8')), 'hex')
    FROM journal_entries e
    LEFT JOIN seals s ON s.table_name = 'journal_entries' AND s.row_id = e.id
   WHERE e.date >= make_date(y, 1, 1) AND e.date < make_date(y + 1, 1, 1)
$$;
--> statement-breakpoint
CREATE FUNCTION haben_close_year() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM haben_lock_audit_chain();
  SELECT d.entries, d.digest INTO NEW.entries, NEW.digest FROM haben_year_digest(NEW.year) d;
  NEW.closed_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER year_closings_close BEFORE INSERT ON year_closings
  FOR EACH ROW EXECUTE FUNCTION haben_close_year();
--> statement-breakpoint
CREATE TRIGGER year_closings_append_only BEFORE UPDATE OR DELETE ON year_closings
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER year_closings_audit AFTER INSERT ON year_closings
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE FUNCTION haben_check_year_open() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM haben_lock_audit_chain();
  IF EXISTS (SELECT 1 FROM year_closings WHERE year = extract(year FROM NEW.date)::integer) THEN
    RAISE EXCEPTION 'Das Jahr % ist abgeschlossen; Buchungen mit Datum darin sind nicht mehr möglich.', extract(year FROM NEW.date)::integer
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_entries_year_open BEFORE INSERT ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION haben_check_year_open();
--> statement-breakpoint
SELECT set_config('haben.actor', '', true);
