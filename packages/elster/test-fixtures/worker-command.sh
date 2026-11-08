#!/bin/sh
# Für process-client.test.ts: steht für einen Worker-Befehl (ERIC_WORKER_COMMAND) wie das Skript, das den Worker
# unter QEMU als x86_64 startet. Startet den Worker mit der Laufzeit aus dem ersten Argument und markiert die Umgebung.
runtime="$1"
shift
HABEN_TEST_WORKER_COMMAND="$*" exec "$runtime" "$@"
