-- #1424: Der Abruf hat den Monat aus „Berichte ab Monat“ unverändert als Apples Fiskalperiode abgefragt. Die ist dem
-- Kalendermonat drei Monate voraus (Periode 2026-01 ist der Oktober 2025); archiviert sind deshalb die Berichte bis drei
-- Monate vor fetch_from, die drei Monate danach fehlen. Seit der Abruf umrechnet, schließt das Zurücksetzen die Lücke;
-- schon archivierte Perioden fragt er nicht erneut ab.
UPDATE "store_connections" SET "fetch_from" = ("fetch_from" - interval '3 months')::date WHERE "store" = 'appstore';
