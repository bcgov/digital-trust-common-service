import { type IncomingHttpHeaders } from 'http';
import { request, Agent } from 'https';

import { DECISION_HOST } from './envoy-harness';

export interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
  reusedSocket: boolean;
}

export interface RawRequestOptions {
  port: number;
  method?: string;
  /**
   * Sent as the request target without any normalisation. A URL object would
   * collapse `..`, `//` and `%2e`, which are exactly the spellings under test.
   */
  path: string;
  headers?: Record<string, string | string[]>;
  body?: string;
  agent?: Agent;
}

let trustedCa: string | undefined;

/**
 * Certificate of the run's listener. Verification stays on; the certificate
 * carries the decision host's name, so that name is what the client checks.
 */
export function trustCertificate(pem: string): void {
  trustedCa = pem;
}

/** Keep-alive agent for tests that need several requests on one connection. */
export function createKeepAliveAgent(): Agent {
  return new Agent({
    keepAlive: true,
    maxSockets: 1,
    ca: trustedCa,
    servername: DECISION_HOST,
  });
}

export function rawRequest(options: RawRequestOptions): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: options.port,
        method: options.method ?? 'GET',
        path: options.path,
        headers: options.headers,
        ca: trustedCa,
        servername: DECISION_HOST,
        agent: options.agent ?? false,
      },
      (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            reusedSocket: req.reusedSocket,
          }),
        );
      },
    );

    req.on('error', reject);
    req.end(options.body);
  });
}
