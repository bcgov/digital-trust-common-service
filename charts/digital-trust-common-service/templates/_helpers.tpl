{{/*
Expand the name of the chart.
*/}}
{{- define "digital-trust-common-service.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this
(by the DNS naming spec). If release name contains chart name it will be used as
a full name.
*/}}
{{- define "digital-trust-common-service.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "digital-trust-common-service.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "digital-trust-common-service.labels" -}}
helm.sh/chart: {{ include "digital-trust-common-service.chart" . }}
{{ include "digital-trust-common-service.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: {{ include "digital-trust-common-service.name" . }}
{{- end }}

{{/*
Selector labels (API / web component)
*/}}
{{- define "digital-trust-common-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "digital-trust-common-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: api
{{- end }}

{{/*
Worker fully qualified name
*/}}
{{- define "digital-trust-common-service.worker.fullname" -}}
{{- printf "%s-worker" (include "digital-trust-common-service.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Worker common labels
*/}}
{{- define "digital-trust-common-service.worker.labels" -}}
helm.sh/chart: {{ include "digital-trust-common-service.chart" . }}
{{ include "digital-trust-common-service.worker.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: {{ include "digital-trust-common-service.name" . }}
{{- end }}

{{/*
Worker selector labels
*/}}
{{- define "digital-trust-common-service.worker.selectorLabels" -}}
app.kubernetes.io/name: {{ include "digital-trust-common-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: worker
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "digital-trust-common-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "digital-trust-common-service.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Fully-qualified container image reference.
Uses image.tag, falling back to the chart appVersion. Registry is optional.
*/}}
{{- define "digital-trust-common-service.image" -}}
{{- $tag := .Values.image.tag | default .Chart.AppVersion -}}
{{- if .Values.image.registry -}}
{{- printf "%s/%s:%s" .Values.image.registry .Values.image.repository $tag -}}
{{- else -}}
{{- printf "%s:%s" .Values.image.repository $tag -}}
{{- end -}}
{{- end }}

{{/*
Name of the Secret holding application credentials.
If secret.existingSecret is set, use it; otherwise fall back to a chart-managed name.
*/}}
{{- define "digital-trust-common-service.secretName" -}}
{{- if .Values.secret.existingSecret -}}
{{- tpl .Values.secret.existingSecret . -}}
{{- else -}}
{{- printf "%s-secret" (include "digital-trust-common-service.fullname" .) -}}
{{- end -}}
{{- end }}

{{/*
Name of the ConfigMap holding non-secret application configuration.
*/}}
{{- define "digital-trust-common-service.configMapName" -}}
{{- printf "%s-config" (include "digital-trust-common-service.fullname" .) -}}
{{- end }}

{{/*
Render the shared application environment variables (non-secret from ConfigMap,
secret from Secret). Used by both the API and Worker pods so their configuration
stays in sync.
*/}}
{{- define "digital-trust-common-service.envFrom" -}}
- configMapRef:
    name: {{ include "digital-trust-common-service.configMapName" . }}
{{ if or .Values.secret.existingSecret .Values.secret.create }}
- secretRef:
    name: {{ include "digital-trust-common-service.secretName" . }}
{{ end }}
{{ with .Values.extraEnvFrom }}
{{ toYaml . }}
{{ end }}
{{- end }}
