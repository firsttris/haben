-- Degressive AfA, Elektrofahrzeuge und Erinnerungswert (docs/anlagen.md): Satz und Erinnerungswert gehören wie die
-- Methode zu den Grundlagen, die nach der ersten Buchung fest sind. Einzige Ausnahme ist der Wechsel von der
-- degressiven zur linearen AfA (§ 7 Abs. 3 Satz 1 EStG): Er lässt sich auch danach setzen oder verschieben, aber nur
-- in ein Jahr, für das noch keine AfA gebucht ist, und nur, solange ein schon gesetzter Wechsel noch nicht gebucht ist.
-- Stand der Funktion wie in 0016_privatnutzung_trigger.sql, ergänzt um die neuen Spalten.

CREATE OR REPLACE FUNCTION haben_reject_booked_asset() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  booked boolean := EXISTS (SELECT 1 FROM asset_depreciations WHERE asset_id = OLD.id) OR OLD.opening_entry_id IS NOT NULL;
  last_booked smallint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF booked OR OLD.document_id IS NOT NULL THEN
      RAISE EXCEPTION 'Anlage % ist gebucht und kann nicht gelöscht werden', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF booked AND (
    NEW.kind IS DISTINCT FROM OLD.kind OR NEW.method IS DISTINCT FROM OLD.method OR NEW.account IS DISTINCT FROM OLD.account
    OR NEW.acquisition_date IS DISTINCT FROM OLD.acquisition_date OR NEW.cost IS DISTINCT FROM OLD.cost
    OR NEW.useful_life_months IS DISTINCT FROM OLD.useful_life_months OR NEW.document_id IS DISTINCT FROM OLD.document_id
    OR NEW.opening_date IS DISTINCT FROM OLD.opening_date OR NEW.opening_book_value IS DISTINCT FROM OLD.opening_book_value
    OR NEW.private_use IS DISTINCT FROM OLD.private_use
    OR NEW.degressive_rate IS DISTINCT FROM OLD.degressive_rate OR NEW.memo_value IS DISTINCT FROM OLD.memo_value
    OR (OLD.opening_entry_id IS NOT NULL AND NEW.opening_entry_id IS DISTINCT FROM OLD.opening_entry_id)
  ) THEN
    RAISE EXCEPTION 'Anlage % ist gebucht, die Berechnungsgrundlagen sind unveränderlich', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF booked AND NEW.linear_from_year IS DISTINCT FROM OLD.linear_from_year THEN
    SELECT max(year) INTO last_booked FROM asset_depreciations WHERE asset_id = OLD.id;
    IF last_booked IS NOT NULL AND (OLD.linear_from_year <= last_booked OR NEW.linear_from_year <= last_booked) THEN
      RAISE EXCEPTION 'Anlage %: Der Wechsel zur linearen AfA geht nur in ein Jahr nach %', OLD.id, last_booked USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
