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
Labels common to all chart resources
*/}}
{{- define "digital-trust-common-service.commonLabels" -}}
helm.sh/chart: {{ include "digital-trust-common-service.chart" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: {{ include "digital-trust-common-service.name" . }}
{{- end }}

{{/*
Base selector labels shared across workloads
*/}}
{{- define "digital-trust-common-service.selectorBaseLabels" -}}
app.kubernetes.io/name: {{ include "digital-trust-common-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Shared labels for non-workload resources (ConfigMaps, Secrets, etc.)
*/}}
{{- define "digital-trust-common-service.labels" -}}
{{ include "digital-trust-common-service.commonLabels" . }}
{{ include "digital-trust-common-service.selectorBaseLabels" . }}
{{- end }}

{{/*
API selector labels
*/}}
{{- define "digital-trust-common-service.api.selectorLabels" -}}
{{ include "digital-trust-common-service.selectorBaseLabels" . }}
app.kubernetes.io/component: api
{{- end }}

{{/*
API labels
*/}}
{{- define "digital-trust-common-service.api.labels" -}}
{{ include "digital-trust-common-service.commonLabels" . }}
{{ include "digital-trust-common-service.api.selectorLabels" . }}
{{- end }}

{{/*
Backward-compatible alias for existing API selector references.
*/}}
{{- define "digital-trust-common-service.selectorLabels" -}}
{{ include "digital-trust-common-service.api.selectorLabels" . }}
{{- end }}

{{/*
Worker fully-qualified name
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
{{ include "digital-trust-common-service.selectorBaseLabels" . }}
app.kubernetes.io/component: worker
{{- end }}

{{/*
Frontend fully-qualified name
*/}}
{{- define "digital-trust-common-service.frontend.fullname" -}}
{{- printf "%s-ui" (include "digital-trust-common-service.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Frontend Caddy config ConfigMap name
*/}}
{{- define "digital-trust-common-service.frontend.configMapName" -}}
{{- printf "%s-ui-caddy" (include "digital-trust-common-service.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Frontend selector labels
*/}}
{{- define "digital-trust-common-service.frontend.selectorLabels" -}}
{{ include "digital-trust-common-service.selectorBaseLabels" . }}
app.kubernetes.io/component: frontend
{{- end }}

{{/*
Frontend labels
*/}}
{{- define "digital-trust-common-service.frontend.labels" -}}
{{ include "digital-trust-common-service.commonLabels" . }}
{{ include "digital-trust-common-service.frontend.selectorLabels" . }}
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
Fully-qualified frontend container image reference.
Falls back to the API image tag when frontend.image.tag is empty.
*/}}
{{- define "digital-trust-common-service.frontend.image" -}}
{{- $tag := .Values.frontend.image.tag | default .Values.image.tag | default .Chart.AppVersion -}}
{{- if .Values.frontend.image.registry -}}
{{- printf "%s/%s:%s" .Values.frontend.image.registry .Values.frontend.image.repository $tag -}}
{{- else -}}
{{- printf "%s:%s" .Values.frontend.image.repository $tag -}}
{{- end -}}
{{- end }}

{{/*
Service exposed by Route/Ingress (frontend when enabled, API otherwise).
*/}}
{{- define "digital-trust-common-service.exposedServiceName" -}}
{{- if .Values.frontend.enabled -}}
{{- include "digital-trust-common-service.frontend.fullname" . -}}
{{- else -}}
{{- include "digital-trust-common-service.fullname" . -}}
{{- end -}}
{{- end }}

{{/*
Service port exposed by Route/Ingress.
*/}}
{{- define "digital-trust-common-service.exposedServicePort" -}}
{{- if .Values.frontend.enabled -}}
{{- .Values.frontend.service.port -}}
{{- else -}}
{{- .Values.service.port -}}
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
Name of the Secret holding the connector encryption keys.
*/}}
{{- define "digital-trust-common-service.connectorEncryptionSecretName" -}}
{{- if .Values.connectorEncryption.existingSecret -}}
{{- tpl .Values.connectorEncryption.existingSecret . -}}
{{- else -}}
{{- printf "%s-connector-encryption" (include "digital-trust-common-service.fullname" .) -}}
{{- end -}}
{{- end }}

{{/*
Name of the Secret holding the OIDC RS256 signing JWKS.
*/}}
{{- define "digital-trust-common-service.oidcSigningSecretName" -}}
{{- if .Values.oidcSigning.existingSecret -}}
{{- tpl .Values.oidcSigning.existingSecret . -}}
{{- else -}}
{{- printf "%s-oidc-signing" (include "digital-trust-common-service.fullname" .) -}}
{{- end -}}
{{- end }}

{{/*
Name of the existing Secret holding upstream federation config JSON.
This Secret is never chart-managed; it must already exist in the namespace.
*/}}
{{- define "digital-trust-common-service.upstreamFederationSecretName" -}}
{{- tpl .Values.upstreamFederation.existingSecret.name . -}}
{{- end -}}

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

{{/*
Environment for the migration hook Job. A pre-install hook runs before any of
the release's own resources exist, so the Job cannot read the ConfigMap the API
and Worker use — `envFrom` on it leaves the pod in CreateContainerConfigError
and the install times out. The non-secret settings are rendered in place
instead, which also means an upgrade migrates against the new values rather
than the previous release's ConfigMap. The Secret stays a reference: a
pre-install hook requires `secret.existingSecret` (migration-job.yaml refuses a
chart-managed one), so it exists before the hook runs.
*/}}
{{- define "digital-trust-common-service.hookEnv" -}}
{{- range $key, $value := .Values.config }}
- name: {{ $key }}
  value: {{ $value | quote }}
{{- end }}
{{- with .Values.extraEnv }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{- define "digital-trust-common-service.hookEnvFrom" -}}
{{- if or .Values.secret.existingSecret .Values.secret.create }}
- secretRef:
    name: {{ include "digital-trust-common-service.secretName" . }}
{{- end }}
{{- with .Values.extraEnvFrom }}
{{ toYaml . }}
{{- end }}
{{- end }}
