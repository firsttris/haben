{{- define "haben.fullname" -}}
{{- if contains "haben" .Release.Name -}}
{{- .Release.Name | trunc 50 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-haben" .Release.Name | trunc 50 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{/* Ohne Anführungszeichen liest YAML etwa off als false, 01234 als 668, 0.10 als 0.1 und 03:15 als 195 */}}
{{- define "haben.text" -}}
{{- if not (kindIs "string" (index . 1)) -}}
{{- fail (printf "%s in Anführungszeichen angeben; ohne liest YAML den Wert etwa als Zahl" (index . 0)) -}}
{{- end -}}
{{- end -}}

{{/* list Repository Tag Name-des-Werts */}}
{{- define "haben.image" -}}
{{- if not (index . 1) -}}
{{- fail (printf "%s fehlt, etwa \"0.9.0\" (https://github.com/Speicherstadt/haben/releases)" (index . 2)) -}}
{{- end -}}
{{- include "haben.text" (list (index . 2) (index . 1)) -}}
{{- printf "%s:%s" (index . 0) (index . 1) -}}
{{- end -}}

{{- define "haben.appImage" -}}
{{- include "haben.image" (list .Values.app.image .Values.image.tag "image.tag") -}}
{{- end -}}

{{/* Datenbank und Backup gehören zur selben PostgreSQL-Version (pg_dump der Version des Servers): postgresql.tag,
sonst image.tag; list Wurzel Repository */}}
{{- define "haben.pgImage" -}}
{{- $root := index . 0 -}}
{{- if $root.Values.postgresql.tag -}}
{{- include "haben.image" (list (index . 1) $root.Values.postgresql.tag "postgresql.tag") -}}
{{- else -}}
{{- include "haben.image" (list (index . 1) $root.Values.image.tag "image.tag") -}}
{{- end -}}
{{- end -}}

{{- define "haben.backupImage" -}}
{{- include "haben.pgImage" (list . .Values.backup.image) -}}
{{- end -}}

{{- define "haben.dbImage" -}}
{{- include "haben.pgImage" (list . .Values.postgresql.image) -}}
{{- end -}}

{{- define "haben.selectorLabels" -}}
app.kubernetes.io/name: haben
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "haben.labels" -}}
{{ include "haben.selectorLabels" . }}
app.kubernetes.io/version: {{ .Values.image.tag | toString | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- /* Label-Werte: höchstens 63 Zeichen, kein „+“ (Kubernetes, Labels and Selectors); Flux baut das Chart aus Git als
0.1.0+<Commit>. Wie helm create und Helm Best Practices, Labels */}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end -}}

{{- define "haben.dbHost" -}}
{{- include "haben.fullname" . }}-db
{{- end -}}

{{- define "haben.appSecret" -}}
{{- .Values.app.existingSecret | default (printf "%s-app" (include "haben.fullname" .)) -}}
{{- end -}}

{{- define "haben.dbSecret" -}}
{{- .Values.postgresql.existingSecret | default (printf "%s-db" (include "haben.fullname" .)) -}}
{{- end -}}

{{- define "haben.backupSecret" -}}
{{- .Values.backup.existingSecret | default (printf "%s-backup" (include "haben.fullname" .)) -}}
{{- end -}}

{{/* Umgebungsvariablen aus einer Map; list Map Name-des-Werts */}}
{{- define "haben.env" -}}
{{- $wert := index . 1 }}
{{- range $name, $value := index . 0 }}
{{- include "haben.text" (list (printf "%s.%s" $wert $name) $value) }}
- name: {{ $name }}
  value: {{ $value | quote }}
{{- end }}
{{- end -}}

{{/* Backup und Wiederherstellen: dieselbe Verbindung, dasselbe Repository */}}
{{- define "haben.backupEnv" -}}
{{- if not (or .Values.backup.persistence.enabled .Values.backup.existingSecret .Values.backup.env.RESTIC_REPOSITORY .Values.backup.secretEnv.RESTIC_REPOSITORY) }}
{{- fail "backup.env.RESTIC_REPOSITORY fehlt: Ohne backup.persistence läge das Repository im Container und wäre nach jedem Neustart weg" }}
{{- end }}
{{- with .Values.backup.env.BACKUP_TIME }}
{{- if not (regexMatch "^([01][0-9]|2[0-3]):[0-5][0-9]$" (toString .)) }}
{{- /* Sonst endet der Container, und mit ihm wäre der Pod der App nicht mehr bereit */}}
{{- fail "backup.env.BACKUP_TIME braucht die Form \"HH:MM\", etwa \"03:15\"" }}
{{- end }}
{{- end }}
{{- /* Für den Cache von restic; Nutzer 1000 hat im Image kein Heimatverzeichnis */}}
- name: HOME
  value: /tmp
{{- if .Values.postgresql.enabled }}
- name: PGHOST
  value: {{ include "haben.dbHost" . }}
- name: PGPASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "haben.dbSecret" . }}
      key: POSTGRES_PASSWORD
{{- end }}
{{- include "haben.env" (list .Values.backup.env "backup.env") }}
{{- end -}}

{{- define "haben.backupVolumeMounts" -}}
- name: backup-tmp
  mountPath: /tmp
- name: backup-state
  mountPath: /var/lib/haben-backup
{{- if .Values.backup.persistence.enabled }}
- name: backups
  mountPath: /backups
{{- end }}
{{- with .Values.backup.extraVolumeMounts }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{- define "haben.backupVolumes" -}}
{{- /* Das Dateisystem ist schreibgeschützt: Dump von backup.sh, Cache von restic (HOME) und der Snapshot, den
restore.sh und restore-check.sh auspacken, auf der Platte des Knotens statt im Speicher */}}
- name: backup-tmp
  emptyDir: {}
- name: backup-state
  emptyDir: {}
{{- if .Values.backup.persistence.enabled }}
- name: backups
  persistentVolumeClaim:
    claimName: {{ include "haben.fullname" . }}-backups
{{- end }}
{{- with .Values.backup.extraVolumes }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{/* Wie die App in deploy/compose.yml: fester Nutzer, Dateisystem schreibgeschützt bis auf die Volumes, keine
Capabilities; erfüllt Pod Security „restricted“. Argument: UID und GID */}}
{{- define "haben.securityContext" -}}
runAsUser: {{ . }}
runAsGroup: {{ . }}
runAsNonRoot: true
readOnlyRootFilesystem: true
allowPrivilegeEscalation: false
capabilities:
  drop: [ALL]
{{- end -}}

{{- define "haben.scheduling" -}}
{{- with .Values.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.affinity }}
affinity:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}
