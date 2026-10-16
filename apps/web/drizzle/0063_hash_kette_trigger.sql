-- GoBD: Manipulationserkennung. Das Audit-Log wird zur Hash-Kette, festgeschriebene Datensätze bekommen ein Siegel.
-- Beides verhindert keine Änderung durch jemanden mit vollem Datenbankzugriff, macht sie aber bei der Prüfung
-- sichtbar, sobald der Kopf der Kette außerhalb des Servers liegt (Export, wöchentliche Mail).

SELECT set_config('haben.actor', 'system:migration', true);
--> statement-breakpoint
-- Hash eines Eintrags: SHA-256(Vorgänger || Inhalt). Der Inhalt ist ein JSON-Array aus den gespeicherten Werten;
-- jsonb hat eine feste Textform, der Zeitpunkt steht unabhängig von der Sitzungszeitzone in UTC.
CREATE FUNCTION haben_audit_hash(prev bytea, r audit_log) RETURNS bytea
LANGUAGE sql STABLE AS $$
  SELECT sha256(prev || convert_to(jsonb_build_array(
    r.seq,
    to_char(r.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    r.actor,
    r.table_name,
    r.row_id,
    r.action,
    r.old_value,
    r.new_value
  )::text, 'UTF8'))
$$;
--> statement-breakpoint
-- Vorgänger des ersten Eintrags
CREATE FUNCTION haben_audit_genesis() RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$ SELECT decode(repeat('00', 32), 'hex') $$;
--> statement-breakpoint
-- Vorhandene Einträge in der Reihenfolge ihrer ID verketten. Das Audit-Log ist sonst nur anhängbar.
ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only;
--> statement-breakpoint
DO $$
DECLARE
  r audit_log;
  prev bytea := haben_audit_genesis();
  n bigint := 0;
BEGIN
  FOR r IN SELECT * FROM audit_log ORDER BY id LOOP
    n := n + 1;
    r.seq := n;
    r.prev_hash := prev;
    r.row_hash := haben_audit_hash(prev, r);
    UPDATE audit_log SET seq = r.seq, prev_hash = r.prev_hash, row_hash = r.row_hash WHERE id = r.id;
    prev := r.row_hash;
  END LOOP;
  INSERT INTO audit_chain (id, seq, hash) VALUES (1, n, prev);
END;
$$;
--> statement-breakpoint
ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only;
--> statement-breakpoint
ALTER TABLE audit_log ALTER COLUMN seq SET NOT NULL;
--> statement-breakpoint
ALTER TABLE audit_log ALTER COLUMN prev_hash SET NOT NULL;
--> statement-breakpoint
ALTER TABLE audit_log ALTER COLUMN row_hash SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_log_seq" ON "audit_log" USING btree ("seq");
--> statement-breakpoint
-- Jeder neue Eintrag hängt sich an den letzten. Die Sperre hält bis zum Ende der Transaktion, parallele Transaktionen
-- verketten also nacheinander; unter READ COMMITTED sieht jede Anweisung danach den zuletzt bestätigten Eintrag. Unter
-- REPEATABLE READ oder SERIALIZABLE gilt der Snapshot vom Anfang der Transaktion, der Vorgänger wäre womöglich nicht
-- sichtbar und die Kette verzweigte sich; dort wird abgelehnt. Eine zurückgerollte Transaktion nimmt ihre Einträge
-- mit, die Nummern bleiben lückenlos. Der Vorgänger kommt über den Index auf seq, der Aufwand je Eintrag bleibt
-- auch bei vielen Einträgen in einer Transaktion gleich.
CREATE FUNCTION haben_audit_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last audit_log;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Änderungen mit Eintrag im Audit-Log nur unter READ COMMITTED, sonst verzweigt die Hash-Kette'
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('haben.audit_chain'));
  SELECT * INTO last FROM audit_log ORDER BY seq DESC LIMIT 1;
  NEW.seq := coalesce(last.seq, 0) + 1;
  NEW.prev_hash := coalesce(last.row_hash, haben_audit_genesis());
  NEW.row_hash := haben_audit_hash(NEW.prev_hash, NEW);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_chain BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION haben_audit_chain();
--> statement-breakpoint
-- Den Kopf erst beim Commit fortschreiben, einmal je Transaktion mit ihrem letzten Eintrag; die Kette selbst steht
-- schon in audit_log. Der Kopf zeigt, ob am Ende Einträge fehlen.
CREATE FUNCTION haben_audit_chain_head() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.seq = (SELECT max(seq) FROM audit_log) THEN
    UPDATE audit_chain SET seq = NEW.seq, hash = NEW.row_hash WHERE id = 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Der Kopf der Kette im Audit-Log fehlt' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER audit_log_chain_head AFTER INSERT ON audit_log
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION haben_audit_chain_head();
--> statement-breakpoint
-- Den Kopf schreibt nur haben_audit_chain_head fort (dort ist die Trigger-Tiefe größer als 1), sonst niemand.
CREATE FUNCTION haben_audit_chain_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Der Kopf der Kette wird nur vom Audit-Log fortgeschrieben' USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_chain_guard BEFORE UPDATE OR DELETE ON audit_chain
  FOR EACH ROW EXECUTE FUNCTION haben_audit_chain_guard();
--> statement-breakpoint
CREATE TRIGGER audit_chain_no_truncate BEFORE TRUNCATE ON audit_chain
  FOR EACH STATEMENT EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
INSERT INTO audit_log (actor, table_name, row_id, action, old_value, new_value)
SELECT 'system:migration', 'audit_chain', '1', 'INSERT', NULL,
  jsonb_build_object(
    'seq', seq,
    'hash', encode(hash, 'hex'),
    'hinweis', format('Kette über die %s vorhandenen Einträge nachträglich gebildet. Sie bezeugt den Stand ab diesem Zeitpunkt, nicht davor.', seq)
  )
  FROM audit_chain;
--> statement-breakpoint
-- Siegel ------------------------------------------------------------------------------------------------------
-- Spalten einer Tabelle in ihrer Reihenfolge
CREATE FUNCTION haben_columns(tbl regclass) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(attname::text ORDER BY attnum), '[]'::jsonb)
    FROM pg_attribute
   WHERE attrelid = tbl AND attnum > 0 AND NOT attisdropped
$$;
--> statement-breakpoint
-- Nur die genannten Spalten einer Zeile
CREATE FUNCTION haben_pick(row_json jsonb, cols jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each(row_json) AS e(k, v) WHERE cols ? k
$$;
--> statement-breakpoint
-- Spalten, über die ein Siegel gebildet wird: der Datensatz und seine abhängigen Zeilen
CREATE FUNCTION haben_seal_columns(tbl text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT CASE tbl
    WHEN 'journal_entries' THEN jsonb_build_object(
      'journal_entries', haben_columns('journal_entries'), 'journal_lines', haben_columns('journal_lines'))
    WHEN 'invoices' THEN jsonb_build_object(
      'invoices', haben_columns('invoices'), 'invoice_lines', haben_columns('invoice_lines'),
      'invoice_taxes', haben_columns('invoice_taxes'))
    WHEN 'documents' THEN jsonb_build_object(
      'documents', haben_columns('documents'), 'document_amounts', haben_columns('document_amounts'))
    WHEN 'vat_returns' THEN jsonb_build_object('vat_returns', haben_columns('vat_returns'))
    WHEN 'cash_entries' THEN jsonb_build_object('cash_entries', haben_columns('cash_entries'))
  END
$$;
--> statement-breakpoint
-- SHA-256 über den Datensatz und seine abhängigen Zeilen, beschränkt auf die Spalten des Siegels. Neue Spalten
-- ändern bestehende Siegel nicht; eine Migration, die eine dieser Spalten umbenennt, löscht oder umrechnet, schon. Die Einstellungen
-- legen die Textform von Zeitstempeln und Binärdaten fest, damit der Hash nicht von der Sitzung abhängt.
CREATE FUNCTION haben_seal_digest(tbl text, rid uuid, cols jsonb) RETURNS text
LANGUAGE plpgsql STABLE
SET TimeZone = 'UTC' SET bytea_output = 'hex' SET IntervalStyle = 'postgres' SET extra_float_digits = 1
AS $$
DECLARE
  content jsonb;
BEGIN
  CASE tbl
    WHEN 'journal_entries' THEN
      content := jsonb_build_object(
        'journal_entries', (SELECT haben_pick(to_jsonb(e), cols -> 'journal_entries') FROM journal_entries e WHERE e.id = rid),
        'journal_lines', (SELECT coalesce(jsonb_agg(haben_pick(to_jsonb(l), cols -> 'journal_lines') ORDER BY l.id), '[]'::jsonb)
                            FROM journal_lines l WHERE l.entry_id = rid));
    WHEN 'invoices' THEN
      content := jsonb_build_object(
        'invoices', (SELECT haben_pick(to_jsonb(i), cols -> 'invoices') FROM invoices i WHERE i.id = rid),
        'invoice_lines', (SELECT coalesce(jsonb_agg(haben_pick(to_jsonb(l), cols -> 'invoice_lines') ORDER BY l.id), '[]'::jsonb)
                            FROM invoice_lines l WHERE l.invoice_id = rid),
        'invoice_taxes', (SELECT coalesce(jsonb_agg(haben_pick(to_jsonb(t), cols -> 'invoice_taxes') ORDER BY t.rate), '[]'::jsonb)
                            FROM invoice_taxes t WHERE t.invoice_id = rid));
    WHEN 'documents' THEN
      content := jsonb_build_object(
        'documents', (SELECT haben_pick(to_jsonb(d), cols -> 'documents') FROM documents d WHERE d.id = rid),
        'document_amounts', (SELECT coalesce(jsonb_agg(haben_pick(to_jsonb(a), cols -> 'document_amounts') ORDER BY a.id), '[]'::jsonb)
                               FROM document_amounts a WHERE a.document_id = rid));
    WHEN 'vat_returns' THEN
      content := jsonb_build_object(
        'vat_returns', (SELECT haben_pick(to_jsonb(v), cols -> 'vat_returns') FROM vat_returns v WHERE v.id = rid));
    WHEN 'cash_entries' THEN
      content := jsonb_build_object(
        'cash_entries', (SELECT haben_pick(to_jsonb(c), cols -> 'cash_entries') FROM cash_entries c WHERE c.id = rid));
    ELSE
      RAISE EXCEPTION 'Für % gibt es kein Siegel', tbl;
  END CASE;
  RETURN encode(sha256(convert_to(content::text, 'UTF8')), 'hex');
END;
$$;
--> statement-breakpoint
CREATE FUNCTION haben_seal() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cols jsonb := haben_seal_columns(TG_TABLE_NAME);
BEGIN
  INSERT INTO seals (table_name, row_id, columns, digest)
  VALUES (TG_TABLE_NAME, NEW.id, cols, haben_seal_digest(TG_TABLE_NAME, NEW.id, cols));
  RETURN NULL;
END;
$$;
--> statement-breakpoint
-- Abhängige Zeilen stehen beim Festschreiben schon fest: danach lehnen ihre Trigger jede Änderung ab.
CREATE TRIGGER journal_entries_seal AFTER UPDATE OF locked_at ON journal_entries
  FOR EACH ROW WHEN (OLD.locked_at IS NULL AND NEW.locked_at IS NOT NULL) EXECUTE FUNCTION haben_seal();
--> statement-breakpoint
CREATE TRIGGER invoices_seal AFTER UPDATE OF locked_at ON invoices
  FOR EACH ROW WHEN (OLD.locked_at IS NULL AND NEW.locked_at IS NOT NULL) EXECUTE FUNCTION haben_seal();
--> statement-breakpoint
CREATE TRIGGER invoices_seal_insert AFTER INSERT ON invoices
  FOR EACH ROW WHEN (NEW.locked_at IS NOT NULL) EXECUTE FUNCTION haben_seal();
--> statement-breakpoint
CREATE TRIGGER documents_seal AFTER UPDATE OF locked_at ON documents
  FOR EACH ROW WHEN (OLD.locked_at IS NULL AND NEW.locked_at IS NOT NULL) EXECUTE FUNCTION haben_seal();
--> statement-breakpoint
CREATE TRIGGER documents_seal_insert AFTER INSERT ON documents
  FOR EACH ROW WHEN (NEW.locked_at IS NOT NULL) EXECUTE FUNCTION haben_seal();
--> statement-breakpoint
CREATE TRIGGER vat_returns_seal AFTER UPDATE OF locked_at ON vat_returns
  FOR EACH ROW WHEN (OLD.locked_at IS NULL AND NEW.locked_at IS NOT NULL) EXECUTE FUNCTION haben_seal();
--> statement-breakpoint
CREATE TRIGGER vat_returns_seal_insert AFTER INSERT ON vat_returns
  FOR EACH ROW WHEN (NEW.locked_at IS NOT NULL) EXECUTE FUNCTION haben_seal();
--> statement-breakpoint
-- Das Kassenbuch ist nur anhängbar: jede Zeile ist ab dem Einfügen fest
CREATE TRIGGER cash_entries_seal AFTER INSERT ON cash_entries
  FOR EACH ROW EXECUTE FUNCTION haben_seal();
--> statement-breakpoint
CREATE TRIGGER seals_append_only BEFORE UPDATE OR DELETE ON seals
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER seals_no_truncate BEFORE TRUNCATE ON seals
  FOR EACH STATEMENT EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER seals_audit AFTER INSERT ON seals
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
-- Siegel für alles, was schon festgeschrieben ist, als nachträglich markiert
INSERT INTO seals (table_name, row_id, columns, digest, genesis)
SELECT tbl, id, haben_seal_columns(tbl), haben_seal_digest(tbl, id, haben_seal_columns(tbl)), true
  FROM (
    SELECT 'journal_entries' AS tbl, id, locked_at FROM journal_entries WHERE locked_at IS NOT NULL
    UNION ALL SELECT 'invoices', id, locked_at FROM invoices WHERE locked_at IS NOT NULL
    UNION ALL SELECT 'documents', id, locked_at FROM documents WHERE locked_at IS NOT NULL
    UNION ALL SELECT 'vat_returns', id, locked_at FROM vat_returns WHERE locked_at IS NOT NULL
    UNION ALL SELECT 'cash_entries', id, created_at FROM cash_entries
  ) locked
 ORDER BY locked_at, tbl, id;
--> statement-breakpoint
-- Prüfung ------------------------------------------------------------------------------------------------------
-- Alle Befunde, je Art höchstens max_rows. art: kette (Audit-Log), kopf (Kopf der Kette), siegel.
CREATE FUNCTION haben_integrity_problems(max_rows integer DEFAULT 100)
RETURNS TABLE (art text, tabelle text, zeile text, seq bigint, befund text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  tbl text;
  locked text;
BEGIN
  RETURN QUERY
  SELECT 'kette'::text, 'audit_log'::text, c.id::text, c.seq,
    CASE
      WHEN c.seq <> coalesce(c.before_seq, 0) + 1 THEN format('Lücke: auf Eintrag %s folgt %s', coalesce(c.before_seq, 0), c.seq)
      WHEN c.prev_hash IS DISTINCT FROM coalesce(c.before_hash, haben_audit_genesis()) THEN 'Verweis auf den Vorgänger passt nicht'
      ELSE 'Inhalt passt nicht zum Hash'
    END
  FROM (
    SELECT a.id, a.seq, a.prev_hash, a.row_hash, haben_audit_hash(a.prev_hash, a) AS calc,
           lag(a.seq) OVER w AS before_seq, lag(a.row_hash) OVER w AS before_hash
      FROM audit_log a
    WINDOW w AS (ORDER BY a.seq)
  ) c
  WHERE c.seq <> coalesce(c.before_seq, 0) + 1
     OR c.prev_hash IS DISTINCT FROM coalesce(c.before_hash, haben_audit_genesis())
     OR c.row_hash IS DISTINCT FROM c.calc
  ORDER BY c.seq
  LIMIT max_rows;

  RETURN QUERY
  SELECT 'kopf'::text, 'audit_chain'::text, NULL::text, h.seq,
    CASE
      WHEN h.id IS NULL THEN 'Kopf der Kette fehlt'
      WHEN last.seq IS DISTINCT FROM h.seq THEN format('Kopf steht bei %s, das Audit-Log endet bei %s', h.seq, last.seq)
      ELSE 'Kopf passt nicht zum letzten Eintrag'
    END
  FROM (SELECT 1) one
  LEFT JOIN audit_chain h ON true
  LEFT JOIN LATERAL (SELECT a.seq, a.row_hash FROM audit_log a ORDER BY a.seq DESC LIMIT 1) last ON true
  WHERE h.id IS NULL OR last.seq IS DISTINCT FROM h.seq OR last.row_hash IS DISTINCT FROM h.hash;

  -- Festgeschrieben heißt: locked_at gesetzt; Kassenbuchzeilen sind es ab dem Einfügen
  FOREACH tbl IN ARRAY ARRAY['journal_entries', 'invoices', 'documents', 'vat_returns', 'cash_entries'] LOOP
    locked := CASE tbl WHEN 'cash_entries' THEN 'true' ELSE 't.locked_at IS NOT NULL' END;
    RETURN QUERY EXECUTE format($q$
      (SELECT 'siegel'::text, %1$L::text, s.row_id::text, NULL::bigint,
         CASE
           WHEN t.id IS NULL THEN 'Versiegelter Datensatz fehlt'
           WHEN NOT (%2$s) THEN 'Festschreibung aufgehoben'
           ELSE 'Inhalt passt nicht zum Siegel'
         END
         FROM seals s
         LEFT JOIN %1$I t ON t.id = s.row_id
        WHERE s.table_name = %1$L
          AND (t.id IS NULL OR NOT (%2$s) OR haben_seal_digest(s.table_name, s.row_id, s.columns) <> s.digest)
        ORDER BY s.id
        LIMIT $1)
      UNION ALL
      (SELECT 'siegel'::text, %1$L::text, t.id::text, NULL::bigint, 'Festgeschrieben, aber ohne Siegel'
         FROM %1$I t
        WHERE %2$s
          AND NOT EXISTS (SELECT 1 FROM seals s WHERE s.table_name = %1$L AND s.row_id = t.id)
        ORDER BY t.id
        LIMIT $1)
    $q$, tbl, locked) USING max_rows;
  END LOOP;

  -- Ein Siegel gilt nur so, wie es in der Kette steht
  RETURN QUERY
  SELECT 'siegel'::text, s.table_name, s.row_id::text, a.seq,
    CASE WHEN a.id IS NULL THEN 'Siegel fehlt im Audit-Log' ELSE 'Siegel weicht vom Eintrag im Audit-Log ab' END
    FROM seals s
    LEFT JOIN audit_log a ON a.table_name = 'seals' AND a.row_id = s.id::text AND a.action = 'INSERT'
   WHERE a.id IS NULL
      OR a.new_value ->> 'digest' IS DISTINCT FROM s.digest
      OR a.new_value -> 'columns' IS DISTINCT FROM s.columns
      OR a.new_value ->> 'row_id' IS DISTINCT FROM s.row_id::text
      OR a.new_value ->> 'table_name' IS DISTINCT FROM s.table_name
   ORDER BY s.id
   LIMIT max_rows;
END;
$$;
--> statement-breakpoint
SELECT set_config('haben.actor', '', true);
