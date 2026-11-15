-- #1137: Eine Instanz, die noch nie etwas gebucht hat, meldete „Kopf der Kette fehlt". Der Kopf entsteht aber
-- erst mit dem ersten Eintrag; solange gar keiner da ist, ist die fehlende Kette der Normalzustand. Die Prüfung
-- meldet nur noch, was ein Fehler ist: Einträge ohne passenden Kopf und einen Kopf, der Einträge behauptet,
-- die das Audit-Log nicht mehr deckt. Nebenbei zählt ein Kopf 0 mit dem Vorgänger des ersten Eintrags als leer —
-- so führt ihn die Vorlage der Hash-Kette in packages/gobd-kern.
CREATE OR REPLACE FUNCTION haben_integrity_problems(max_rows integer DEFAULT 100)
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

  -- Ohne einen einzigen Eintrag hat die Kette noch nichts zu bezeugen: der Kopf entsteht mit dem ersten Eintrag.
  -- Eine frische Instanz nach einem Reset ist damit kein Befund, ein Kopf 0 mit dem Vorgänger des ersten Eintrags
  -- ebenso wenig. Ein Kopf, der Einträge behauptet, die nicht mehr da sind, bleibt einer (#1137).
  RETURN QUERY
  SELECT 'kopf'::text, 'audit_chain'::text, NULL::text, coalesce(h.seq, 0),
    CASE
      WHEN h.id IS NULL THEN 'Kopf der Kette fehlt'
      WHEN coalesce(last.seq, 0) IS DISTINCT FROM h.seq
        THEN format('Kopf steht bei %s, das Audit-Log endet bei %s', h.seq, coalesce(last.seq, 0))
      ELSE 'Kopf passt nicht zum letzten Eintrag'
    END
  FROM (SELECT 1) one
  LEFT JOIN audit_chain h ON true
  LEFT JOIN LATERAL (SELECT a.seq, a.row_hash FROM audit_log a ORDER BY a.seq DESC LIMIT 1) last ON true
  WHERE coalesce(last.seq, 0) IS DISTINCT FROM coalesce(h.seq, 0)
     OR (last.seq IS NOT NULL AND (h.id IS NULL OR last.row_hash IS DISTINCT FROM h.hash));

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
