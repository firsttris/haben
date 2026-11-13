#!/bin/sh
# Reale Bun-Gegenprobe der Entrypoint-Übergabe nach erfolgreicher Migration, ohne Migrations-/Rechte-Stubs.
# Bun lädt .env selbst: https://bun.com/docs/runtime/environment-variables
set -eu
cd "$(dirname "$0")/../.."
repository=$PWD
real_bun=$(command -v bun)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/apps/web"
cat > "$work/apps/web/.env" <<'ENV'
MIGRATION_DATABASE_URL=postgres://fake_owner:fake_password@invalid.example/haben
HABEN_DOTENV_PROBE=erhalten
ENV
# Ersetzt nur den Serveraufruf der Übergabe durch einen tatsächlichen Bun-Prozess mit demselben CWD und derselben Umgebung.
# Die Migration selbst ist kein Teil dieser Prozess-/dotenv-Probe; die Startprüfung führt sie unverändert aus.
cat > "$work/bin/bun" <<'SH'
#!/bin/sh
exec "$HABEN_REAL_BUN" -e '
const ownerAddressAvailable = Boolean(process.env.MIGRATION_DATABASE_URL);
const otherConfigurationAvailable = process.env.HABEN_DOTENV_PROBE === "erhalten";
console.log(JSON.stringify({ ownerAddressAvailable, otherConfigurationAvailable }));
if (ownerAddressAvailable || !otherConfigurationAvailable) process.exit(1);
'
SH
chmod 755 "$work/bin/bun"
export HABEN_REAL_BUN="$real_bun"
failed=0
for kind in betrieb entwicklung; do
  case "$kind" in
    betrieb) source="$repository/deploy/entrypoint.sh"; start="$work/apps/web" ;;
    entwicklung) source="$repository/deploy/dev/start.sh"; start="$work" ;;
  esac
  awk 'handoff { print } /^bun (src\/server\/db\/migrate\.ts|run db:migrate)$/ { handoff = 1 }' "$source" > "$work/uebergabe.sh"
  grep -q '^exec bun' "$work/uebergabe.sh"
  echo "Entrypoint-Übergabe: $kind"
  if (
    cd "$start"
    export PATH="$work/bin:$PATH" MIGRATION_DATABASE_URL=postgres://inherited_owner:fake_password@invalid.example/haben
    export ERIC_HOME= ERIC_AUTO_INSTALL= HABEN_DEV_PORT=3386 NODE_ENV=production
    unset HABEN_DOTENV_PROBE
    sh -eu "$work/uebergabe.sh"
  ); then :; else failed=1; fi
done
exit "$failed"
