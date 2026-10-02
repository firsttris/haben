-- Importe, Umsätze und Zuordnungen sind unveränderlich; Korrekturen laufen über Gegenzeilen.

CREATE TRIGGER bank_imports_append_only BEFORE UPDATE OR DELETE ON bank_imports
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER bank_transactions_append_only BEFORE UPDATE OR DELETE ON bank_transactions
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER allocations_append_only BEFORE UPDATE OR DELETE ON allocations
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER bank_accounts_audit AFTER INSERT OR UPDATE OR DELETE ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER bank_imports_audit AFTER INSERT ON bank_imports
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER allocations_audit AFTER INSERT ON allocations
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
-- Eine Zuordnung darf den Umsatz nicht übersteigen und muss sein Vorzeichen tragen.
CREATE FUNCTION haben_check_allocation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  tx_amount integer;
  allocated bigint;
BEGIN
  SELECT amount INTO tx_amount FROM bank_transactions WHERE id = NEW.transaction_id FOR UPDATE;
  SELECT coalesce(sum(amount), 0) INTO allocated FROM allocations WHERE transaction_id = NEW.transaction_id;
  IF NEW.reverses_id IS NULL AND sign(NEW.amount) <> sign(tx_amount) THEN
    RAISE EXCEPTION 'Zuordnung hat ein anderes Vorzeichen als der Umsatz' USING ERRCODE = 'check_violation';
  END IF;
  IF abs(allocated + NEW.amount) > abs(tx_amount) OR sign(allocated + NEW.amount) * sign(tx_amount) < 0 THEN
    RAISE EXCEPTION 'Zuordnung übersteigt den Umsatz (% von %)', allocated + NEW.amount, tx_amount
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER allocations_check BEFORE INSERT ON allocations
  FOR EACH ROW EXECUTE FUNCTION haben_check_allocation();
