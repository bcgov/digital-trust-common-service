import { execFileSync, spawnSync } from 'child_process';
import { chmodSync, copyFileSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const CHART = 'charts/digital-trust-common-service';

/**
 * The host the rendered config expects for the decision endpoint, derived by
 * the chart from the release name and namespace used below.
 */
export const DECISION_HOST =
  'hermetic-digital-trust-common-service-log-access.loggw.svc';
export const UPSTREAM_HOST = 'fake-loki.test';
/** A stand-in for the gateway's own Loki login. Not a real credential. */
export const GATEWAY_LOKI_AUTHORIZATION = `Basic ${Buffer.from('gateway:hermetic-test-only').toString('base64')}`;

/** Port the rendered config dials on the decision host. */
export const DECISION_PORT = 8443;

export interface RunningEnvoy {
  /** Host port mapped to the gateway listener. */
  port: number;
  logs(): string;
  stop(): void;
}

function run(command: string, args: string[], input?: string): string {
  return execFileSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function renderEnvoyConfig(upstreamPort: number): string {
  const rendered = run('helm', [
    'template',
    'hermetic',
    CHART,
    '-n',
    'loggw',
    '-f',
    `${CHART}/ci/ci-values.yaml`,
    '--set',
    `logGateway.upstream.host=${UPSTREAM_HOST}`,
    '--set',
    `logGateway.upstream.port=${upstreamPort}`,
    '--set',
    'logGateway.upstream.timeout=2s',
    '--show-only',
    'templates/log-gateway/configmap.yaml',
  ]);
  const config = run(
    'yq',
    ['select(.data."envoy.yaml") | .data."envoy.yaml"'],
    rendered,
  );

  if (!config.includes(DECISION_HOST)) {
    throw new Error(
      `Rendered Envoy config no longer targets ${DECISION_HOST}; update the harness.`,
    );
  }

  return config;
}

/**
 * Generates the run's TLS material: one self-signed certificate that serves
 * as the decision endpoint's certificate and as the CA Envoy trusts. The
 * image runs as a non-root user, so the files are world-readable; they are
 * generated for this run and trusted by nothing else.
 */
export function createTlsMaterial(): string {
  const dir = mkdtempSync(join(tmpdir(), 'log-gateway-hermetic-'));

  run('openssl', [
    'req',
    '-x509',
    '-nodes',
    '-newkey',
    'rsa:2048',
    '-days',
    '1',
    '-subj',
    `/CN=${DECISION_HOST}`,
    '-addext',
    `subjectAltName=DNS:${DECISION_HOST}`,
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-keyout',
    join(dir, 'tls.key'),
    '-out',
    join(dir, 'tls.crt'),
  ]);
  copyFileSync(join(dir, 'tls.crt'), join(dir, 'service-ca.crt'));
  chmodSync(dir, 0o755);
  for (const file of ['tls.crt', 'tls.key', 'service-ca.crt']) {
    chmodSync(join(dir, file), 0o644);
  }

  return dir;
}

/**
 * Starts Envoy in plain Docker with the config exactly as the chart renders
 * it. The decision endpoint and Loki stand-in run on the host.
 */
export function startEnvoy(dir: string, upstreamPort: number): RunningEnvoy {
  const envoyYaml = join(dir, 'envoy.yaml');
  const tag = run('yq', [
    '-r',
    '.logGateway.image.tag',
    `${CHART}/values.yaml`,
  ]).trim();

  writeFileSync(envoyYaml, renderEnvoyConfig(upstreamPort));
  chmodSync(envoyYaml, 0o644);

  const name = `log-gateway-hermetic-${process.pid}`;

  run('docker', [
    'run',
    '-d',
    '--name',
    name,
    '--add-host',
    `${DECISION_HOST}:host-gateway`,
    '--add-host',
    `${UPSTREAM_HOST}:host-gateway`,
    '-e',
    `LOKI_AUTHORIZATION=${GATEWAY_LOKI_AUTHORIZATION}`,
    '-v',
    `${envoyYaml}:/etc/envoy/envoy.yaml:ro`,
    '-v',
    `${dir}:/var/run/secrets/log-gateway-tls:ro`,
    '-v',
    `${dir}:/var/run/secrets/openshift-service-ca:ro`,
    '-p',
    '127.0.0.1::8443',
    `envoyproxy/envoy:${tag}`,
    '-c',
    '/etc/envoy/envoy.yaml',
  ]);

  const mapping = run('docker', ['port', name, '8443/tcp'])
    .trim()
    .split('\n')[0];
  const port = parseInt(mapping.slice(mapping.lastIndexOf(':') + 1), 10);

  return {
    port,
    logs: () => {
      const result = spawnSync('docker', ['logs', name], { encoding: 'utf8' });

      return `${result.stdout}${result.stderr}`;
    },
    stop: () => {
      spawnSync('docker', ['rm', '-f', name]);
    },
  };
}
