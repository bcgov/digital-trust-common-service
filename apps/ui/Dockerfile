# Build context is apps/ui (the UI is a self-contained npm project with its
# own lockfile; src/lib/api/types.gen.ts is committed, so no access to the
# repo-root OpenAPI spec is needed here).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Vite inlines VITE_* variables into the bundle at build time, so the auth mode
# is baked into the image rather than settable at runtime. Defaults to the mock
# AuthClient; build with --build-arg VITE_AUTH_MODE=oidc once the interactive
# OIDC flow lands (#83 / AU-02).
ARG VITE_AUTH_MODE=mock
ENV VITE_AUTH_MODE=$VITE_AUTH_MODE

RUN npm run build

FROM caddy:2.11-alpine AS production

# The base image ships /usr/bin/caddy with the cap_net_bind_service file
# capability. OpenShift's restricted-v2 SCC mandates
# allowPrivilegeEscalation=false, and the kernel refuses to exec ANY binary
# carrying file capabilities when that bit is clear — the container dies with
# "exec /usr/bin/caddy: operation not permitted" before Caddy ever starts.
# We listen on 8080, so the capability buys us nothing; strip it.
RUN setcap -r /usr/bin/caddy

# OpenShift assigns an arbitrary UID at runtime but always puts it in GID 0,
# so group-writable is what makes /data (TLS storage) and /config (autosave)
# usable. USER 1001 keeps the image non-root on plain Docker/Kubernetes too.
RUN chown -R 1001:0 /data /config /srv \
	&& chmod -R g+rwX /data /config /srv

COPY --from=build --chown=1001:0 /app/dist /srv
COPY --chown=1001:0 Caddyfile /etc/caddy/Caddyfile

EXPOSE 8080
USER 1001

# CMD inherited from the base image:
#   caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
