-- Verrechnung gegenläufiger Umsätze (#457): nur anhängbar, jede Zeile im Audit-Log. Die Umsätze selbst bleiben
-- unverändert und gesperrt. Der Trigger prüft ein zweites Mal, was der Server vorher prüft: zwei Umsätze desselben Kontos,
-- die zusammen null ergeben, ohne Zuordnung und ohne andere gültige Verrechnung; eine Gegenzeile nennt dieselben Umsätze
-- wie die aufgehobene Zeile. Zuordnungen auf einen verrechneten Umsatz lehnt ein eigener Trigger ab.

SELECT set_config('haben.actor', 'system:migration', true);
--> statement-breakpoint
CREATE TRIGGER bank_neutralizations_append_only BEFORE UPDATE OR DELETE ON bank_neutralizations
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER bank_neutralizations_audit AFTER INSERT ON bank_neutralizations
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
-- Gültig ist eine Verrechnung, die keine Gegenzeile ist und keine hat
CREATE OR REPLACE FUNCTION haben_bank_neutralized(tx_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM bank_neutralizations n
     WHERE (n.transaction_id = tx_id OR n.counter_transaction_id = tx_id)
       AND n.reverses_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM bank_neutralizations r WHERE r.reverses_id = n.id)
  );
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION haben_check_bank_neutralization() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  a bank_transactions%ROWTYPE;
  b bank_transactions%ROWTYPE;
  original bank_neutralizations%ROWTYPE;
BEGIN
  -- Dieselbe Sperre wie beim Zuordnen, in fester Reihenfolge: zwei gleichzeitige Verrechnungen blockieren sich nicht gegenseitig
  PERFORM 1 FROM bank_transactions WHERE id IN (NEW.transaction_id, NEW.counter_transaction_id) ORDER BY id FOR UPDATE;
  SELECT * INTO a FROM bank_transactions WHERE id = NEW.transaction_id;
  SELECT * INTO b FROM bank_transactions WHERE id = NEW.counter_transaction_id;
  IF NEW.reverses_id IS NOT NULL THEN
    SELECT * INTO original FROM bank_neutralizations WHERE id = NEW.reverses_id;
    IF original.reverses_id IS NOT NULL
       OR (original.transaction_id, original.counter_transaction_id) IS DISTINCT FROM (NEW.transaction_id, NEW.counter_transaction_id) THEN
      RAISE EXCEPTION 'Gegenzeile einer Verrechnung muss dieselben Umsätze nennen' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF a.bank_account_id <> b.bank_account_id THEN
    RAISE EXCEPTION 'Verrechnen nur zwischen Umsätzen auf demselben Konto' USING ERRCODE = 'check_violation';
  END IF;
  IF a.amount = 0 OR a.amount + b.amount <> 0 OR a.currency <> b.currency THEN
    RAISE EXCEPTION 'Die Umsätze heben sich nicht auf (% und %)', a.amount, b.amount USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM allocations WHERE transaction_id IN (a.id, b.id) GROUP BY transaction_id HAVING sum(amount) <> 0) THEN
    RAISE EXCEPTION 'Ein Umsatz der Verrechnung ist zugeordnet' USING ERRCODE = 'check_violation';
  END IF;
  IF haben_bank_neutralized(a.id) OR haben_bank_neutralized(b.id) THEN
    RAISE EXCEPTION 'Ein Umsatz ist schon verrechnet' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bank_neutralizations_check BEFORE INSERT ON bank_neutralizations
  FOR EACH ROW EXECUTE FUNCTION haben_check_bank_neutralization();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION haben_check_allocation_not_neutralized() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reverses_id IS NULL AND haben_bank_neutralized(NEW.transaction_id) THEN
    RAISE EXCEPTION 'Der Umsatz ist verrechnet; erst die Verrechnung aufheben' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER allocations_not_neutralized BEFORE INSERT ON allocations
  FOR EACH ROW EXECUTE FUNCTION haben_check_allocation_not_neutralized();
