-- Splitbuchung: Ein Umsatz lässt sich in Teile mit eigenem Ziel aufteilen, auch mit umgekehrtem Vorzeichen
-- (Auszahlung 90,00 = Rechnung +100,00 und Gebühr −10,00). Einzeln überschreitet ein Teil den Umsatz, erst alle
-- zusammen ergeben ihn. Die Prüfung läuft deshalb verzögert am Ende der Transaktion und sieht dann alle Teile.
-- Zuordnungen ohne Aufteilung müssen wie bisher das Vorzeichen des Umsatzes tragen; eine Aufteilung braucht mindestens
-- zwei Teile, darunter einen mit dem Vorzeichen des Umsatzes.
CREATE OR REPLACE FUNCTION haben_check_allocation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  tx_amount integer;
  allocated bigint;
  parts integer;
  same_sign integer;
BEGIN
  SELECT amount INTO tx_amount FROM bank_transactions WHERE id = NEW.transaction_id FOR UPDATE;
  -- Läuft nach dem Einfügen: die Summe enthält NEW und alle anderen Teile derselben Transaktion
  SELECT coalesce(sum(amount), 0) INTO allocated FROM allocations WHERE transaction_id = NEW.transaction_id;
  IF NEW.reverses_id IS NULL AND NEW.split_id IS NULL AND sign(NEW.amount) <> sign(tx_amount) THEN
    RAISE EXCEPTION 'Zuordnung hat ein anderes Vorzeichen als der Umsatz' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reverses_id IS NULL AND NEW.amount = 0 THEN
    RAISE EXCEPTION 'Zuordnung über 0' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reverses_id IS NULL AND NEW.split_id IS NOT NULL THEN
    SELECT count(*), count(*) FILTER (WHERE sign(amount) = sign(tx_amount)) INTO parts, same_sign
      FROM allocations WHERE split_id = NEW.split_id AND reverses_id IS NULL;
    IF parts < 2 OR same_sign = 0 THEN
      RAISE EXCEPTION 'Eine Aufteilung braucht mindestens zwei Teile, einer davon mit dem Vorzeichen des Umsatzes'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF abs(allocated) > abs(tx_amount) OR sign(allocated) * sign(tx_amount) < 0 THEN
    RAISE EXCEPTION 'Zuordnung übersteigt den Umsatz (% von %)', allocated, tx_amount
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER allocations_check ON allocations;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER allocations_check AFTER INSERT ON allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION haben_check_allocation();
