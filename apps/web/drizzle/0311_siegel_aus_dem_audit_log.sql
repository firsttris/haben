-- Integritätsprüfung: Siegel, die im Audit-Log stehen, aber in seals fehlen. Mit abgeschalteten Triggern lassen sich ein
-- festgeschriebener Datensatz und sein Siegel gemeinsam löschen. Alle Prüfungen in haben_integrity_problems gingen bisher
-- von vorhandenen Siegeln oder vorhandenen Datensätzen aus und meldeten dann nichts; auch der Prüfwert von außerhalb stimmt,
-- weil das Audit-Log unverändert bleibt. Jedes Siegel steht aber mit seinem INSERT in der Kette (seals_audit, 0063), und
-- seals ist nur anhängbar: Ein Eintrag ohne Siegel heißt, dass es gelöscht wurde.
--
-- haben_integrity_problems wie in 0310_siegel_unabgedeckte_spalten, um den Block vor dem Abgleich der Siegel mit der Kette
-- erweitert. Beide Blöcke begrenzen je Tabelle wie die übrigen, weil integrity.ts „oder mehr“ je Art und Tabelle meldet.
-- Nur lesend, an Daten und Siegeln ändert die Migration nichts.
CREATE OR REPLACE FUNCTION haben_integrity_problems(max_rows integer DEFAULT 100)
RETURNS TABLE (art text, tabelle text, zeile text, seq bigint, befund text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  tbl text;
  locked text;
  heute jsonb;
  listen jsonb;
  teil text;
  fk text;
  fehlend text[];
  spalte text;
  ausdruck text;
  wert jsonb;
  standard jsonb;
  werte text;
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

  FOREACH tbl IN ARRAY ARRAY['journal_entries', 'invoices', 'documents', 'vat_returns', 'cash_entries',
                             'allocations', 'pauschalen', 'asset_depreciations', 'document_cancellations',
                             'payslips', 'payslip_cancellations'] LOOP
    locked := CASE WHEN tbl IN ('cash_entries', 'allocations', 'pauschalen', 'asset_depreciations', 'document_cancellations',
                                'payslip_cancellations') THEN 'true'
                   ELSE 't.locked_at IS NOT NULL' END;
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

    -- Was ältere Siegel dieser Tabelle nicht abdecken
    heute := haben_seal_columns(tbl);
    SELECT coalesce(jsonb_agg(DISTINCT s.columns), '[]'::jsonb) INTO listen
      FROM seals s WHERE s.table_name = tbl AND s.columns <> heute;
    FOR teil IN SELECT jsonb_object_keys(heute) LOOP
      -- Spalte, über die haben_seal_digest die Zeilen des Datensatzes findet. Eine neue Kindtabelle im Siegel fällt
      -- hier bei jedem Lauf auf, nicht erst auf einer Instanz mit älteren Siegeln.
      fk := CASE
        WHEN teil = tbl THEN 'id'
        WHEN teil = 'journal_lines' THEN 'entry_id'
        WHEN teil IN ('invoice_lines', 'invoice_taxes', 'invoice_attachments') THEN 'invoice_id'
        WHEN teil IN ('document_amounts', 'document_splits') THEN 'document_id'
        WHEN teil = 'vat_return_filings' THEN 'vat_return_id'
      END;
      IF fk IS NULL THEN
        RAISE EXCEPTION 'Integritätsprüfung kennt % im Siegel von % nicht', teil, tbl;
      END IF;
      -- Ohne abweichende Spaltenliste ist nichts zu prüfen
      CONTINUE WHEN listen = '[]'::jsonb;

      -- Kindtabelle, die das Siegel nicht nennt: keine Zeile zu diesem Datensatz
      RETURN QUERY EXECUTE format($q$
        SELECT 'siegel'::text, %1$L::text, s.row_id::text, NULL::bigint,
               format('Zeile in %%s eingefügt, die das Siegel nicht abdeckt', %2$L)
          FROM seals s
         WHERE s.table_name = %1$L AND NOT s.columns ? %2$L
           AND EXISTS (SELECT 1 FROM %2$I t WHERE t.%3$I = s.row_id)
         ORDER BY s.id
         LIMIT $1
      $q$, tbl, teil, fk) USING max_rows;

      -- Spalten, die mindestens einem Siegel fehlen, mit ihrem Standardwert aus dem Katalog
      SELECT array_agg(DISTINCT c) INTO fehlend
        FROM jsonb_array_elements(listen) alt(liste), jsonb_array_elements_text(heute -> teil) c
       WHERE alt.liste ? teil AND NOT (alt.liste -> teil) ? c;
      CONTINUE WHEN fehlend IS NULL;
      standard := '{}'::jsonb;
      FOR spalte, ausdruck IN
        SELECT a.attname::text, format('(%s)::%s', pg_get_expr(d.adbin, d.adrelid), format_type(a.atttypid, a.atttypmod))
          FROM pg_attribute a
          JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE a.attrelid = teil::regclass AND a.attname = ANY (fehlend)
      LOOP
        EXECUTE format('SELECT to_jsonb(%s)', ausdruck) INTO wert;
        IF wert IS NOT NULL THEN
          standard := standard || jsonb_build_object(spalte, wert);
        END IF;
      END LOOP;
      SELECT string_agg(format('(%L, to_jsonb(t.%I))', c, c), ', ') INTO werte FROM unnest(fehlend) c;
      RETURN QUERY EXECUTE format($q$
        SELECT 'siegel'::text, %1$L::text, x.row_id::text, NULL::bigint,
               format('Spalte %%s.%%s geändert, die das Siegel nicht abdeckt', %2$L, x.spalte)
          FROM (SELECT DISTINCT s.id, s.row_id, w.spalte
                  FROM seals s
                  JOIN %2$I t ON t.%3$I = s.row_id
                 CROSS JOIN LATERAL (VALUES %4$s) w(spalte, wert)
                 WHERE s.table_name = %1$L AND s.columns <> $2 AND s.columns ? %2$L
                   AND NOT (s.columns -> %2$L) ? w.spalte
                   AND w.wert IS DISTINCT FROM ($3 -> w.spalte)) x
         ORDER BY x.id, x.spalte
         LIMIT $1
      $q$, tbl, teil, fk, werte) USING max_rows, heute, standard;
    END LOOP;
  END LOOP;

  -- Jedes Siegel aus der Kette gibt es noch: Wer einen festgeschriebenen Datensatz samt Siegel löscht, hinterlässt keine
  -- Zeile, von der die Prüfungen oben ausgehen. Der Eintrag des Siegels im Audit-Log bleibt aber stehen; ihn zu löschen reißt
  -- eine Lücke in die Kette. Höchstens max_rows je Tabelle wie oben: integrity.ts meldet „oder mehr“ je Art und Tabelle.
  RETURN QUERY
  SELECT 'siegel'::text, x.siegel_tabelle, x.siegel_zeile, x.eintrag, 'Siegel fehlt, steht aber im Audit-Log'::text
    FROM (SELECT a.new_value ->> 'table_name' AS siegel_tabelle, a.new_value ->> 'row_id' AS siegel_zeile, a.seq AS eintrag,
                 row_number() OVER (PARTITION BY a.new_value ->> 'table_name' ORDER BY a.seq) AS nr
            FROM audit_log a
           WHERE a.table_name = 'seals' AND a.action = 'INSERT'
             AND NOT EXISTS (SELECT 1 FROM seals s WHERE s.id::text = a.row_id)) x
   WHERE x.nr <= max_rows
   ORDER BY x.eintrag;

  -- Ein Siegel gilt nur so, wie es in der Kette steht. Höchstens max_rows je Tabelle wie oben (bis 0310 über alle zusammen).
  RETURN QUERY
  SELECT 'siegel'::text, x.siegel_tabelle, x.siegel_zeile, x.eintrag, x.meldung
    FROM (SELECT s.id AS siegel, s.table_name AS siegel_tabelle, s.row_id::text AS siegel_zeile, a.seq AS eintrag,
                 CASE WHEN a.id IS NULL THEN 'Siegel fehlt im Audit-Log' ELSE 'Siegel weicht vom Eintrag im Audit-Log ab' END AS meldung,
                 row_number() OVER (PARTITION BY s.table_name ORDER BY s.id) AS nr
            FROM seals s
            LEFT JOIN audit_log a ON a.table_name = 'seals' AND a.row_id = s.id::text AND a.action = 'INSERT'
           WHERE a.id IS NULL
              OR a.new_value ->> 'digest' IS DISTINCT FROM s.digest
              OR a.new_value -> 'columns' IS DISTINCT FROM s.columns
              OR a.new_value ->> 'row_id' IS DISTINCT FROM s.row_id::text
              OR a.new_value ->> 'table_name' IS DISTINCT FROM s.table_name) x
   WHERE x.nr <= max_rows
   ORDER BY x.siegel;
END;
$$;
