-- Backup und pg_upgrade müssen die App-Rechte einschließlich Sequenzen erhalten; keine Eigentümerverbindung als Probe.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF current_user <> 'haben_app' OR session_user <> 'haben_app' THEN
    RAISE EXCEPTION 'Die Betriebsprobe braucht die echte App-Anmeldung';
  END IF;
  IF has_database_privilege(current_user, current_database(), 'TEMP')
     OR has_schema_privilege(current_user, 'public', 'CREATE')
     OR has_parameter_privilege(current_user, 'session_replication_role', 'SET') THEN
    RAISE EXCEPTION 'Die App hat nach dem Betriebswechsel unsichere Rechte';
  END IF;
END;
$$;
SELECT set_config('haben.actor', 'test:rollen-betrieb', true);
INSERT INTO journal_entries (date, description, source_type, source_id, kontenrahmen)
VALUES ('2026-01-10', 'Rollentest nach Backup oder Upgrade', 'manuell', gen_random_uuid(), 'SKR03') RETURNING id AS entry_id \gset
INSERT INTO journal_lines (entry_id, account, debit, credit)
VALUES (:'entry_id', '1200', 100, 0), (:'entry_id', '8400', 0, 100);
UPDATE journal_entries SET locked_at = now() WHERE id = :'entry_id';
SET CONSTRAINTS ALL IMMEDIATE;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM seals s JOIN journal_entries e ON e.id = s.row_id
    WHERE s.table_name = 'journal_entries' AND e.description = 'Rollentest nach Backup oder Upgrade'
  ) THEN
    RAISE EXCEPTION 'Die App-Buchung hat kein Siegel';
  END IF;
  IF EXISTS (SELECT 1 FROM haben_integrity_problems(1)) THEN
    RAISE EXCEPTION 'Kette oder Siegel nach der App-Buchung beschädigt';
  END IF;
END;
$$;
ROLLBACK;
