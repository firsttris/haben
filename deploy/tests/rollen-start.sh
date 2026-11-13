#!/bin/bash
# Neue Installation nach derselben Reihenfolge wie in der Anleitung: db, Rolle einmalig, app.
# Nur Testkennwörter; alle Ressourcen gehören zum ausdrücklich angegebenen Wegwerf-Projekt.
set -euo pipefail
cd "${BASH_SOURCE[0]%/*}/../.."
: "${COMPOSE_PROJECT_NAME:?Eigenes Wegwerf-COMPOSE_PROJECT_NAME fehlt}"
if [ -n "$(docker ps -aq --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME")" ] \
  || [ -n "$(docker volume ls -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME")" ]; then
  echo 'Das Testprojekt muss leer sein; vorhandene Container oder Volumes bleiben unberührt.' >&2
  exit 1
fi
export DOMAIN=haben.test DB_PASSWORD=rollentest_owner AUTH_SECRET=rollentest_geheimnis_mindestens_zweiunddreissig_zeichen
export ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= RESTIC_PASSWORD=rollentest_backup
export DATABASE_URL=postgres://haben_app:rollentest_app@db:5432/haben
export MIGRATION_DATABASE_URL=postgres://haben:rollentest_owner@db:5432/haben
compose=(docker compose -f deploy/compose.yml -f deploy/tests/rollen-compose.yml)
cleanup() {
  result=$?
  if [ "$result" != 0 ]; then "${compose[@]}" logs --tail 80; fi
  "${compose[@]}" down -v --remove-orphans
}
trap cleanup EXIT
wait_app() {
  for _ in $(seq 90); do
    if curl --max-time 5 -sf -o /dev/null "http://localhost:${HABEN_TEST_PORT:-3386}/login"; then return; fi
    sleep 2
  done
  return 1
}
"${compose[@]}" up -d --wait db
# createuser fragt zweimal nach dem neuen Passwort. Im Betrieb interaktiv, hier ausschließlich erfundene Werte.
printf 'rollentest_app\nrollentest_app\n' | "${compose[@]}" exec -T db createuser -U haben --login --no-superuser --no-createdb --no-createrole --pwprompt haben_app
"${compose[@]}" up -d app
app=$("${compose[@]}" ps -q app)
wait_app
sh deploy/tests/rollen-pruefen.sh "$app"
docker exec -i "$app" sh -c 'cat > /tmp/externe-module.ts && bun /tmp/externe-module.ts' < scripts/container/externe-module.ts
docker exec -i "$app" sh < scripts/container/pdf-werkzeuge.sh
# Bestehende .env ohne zweite Adresse: unveränderter Start über den bisherigen Eigentümerzugang.
unset DATABASE_URL MIGRATION_DATABASE_URL
"${compose[@]}" up -d --force-recreate app
wait_app
docker exec -w /app/apps/web "$("${compose[@]}" ps -q app)" bun -e '
const sql = (await import("postgres")).default(process.env.DATABASE_URL);
try { const [role] = await sql`select current_user as name`; if (role.name !== "haben") throw new Error("Legacy-Anmeldung geändert"); }
finally { await sql.end(); }
'
echo 'Neue Installation und Legacy-Start geprüft'
