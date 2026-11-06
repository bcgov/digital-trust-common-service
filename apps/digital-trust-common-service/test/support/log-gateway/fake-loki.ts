import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'http';
import type { AddressInfo, Socket } from 'net';

export interface RecordedRequest {
  method: string;
  /** Path and query exactly as Envoy sent them. */
  target: string;
  headers: IncomingHttpHeaders;
  body: string;
}

type Behaviour = 'ok' | 'reset' | 'hang' | 'error';

const EMPTY_RESULT = JSON.stringify({
  status: 'success',
  data: { resultType: 'streams', result: [] },
});

/**
 * Stand-in for Loki. It records everything it receives, so a test asserts
 * what crossed the gateway, and can be told to fail or hang.
 */
export class FakeLoki {
  public readonly requests: RecordedRequest[] = [];

  private server?: Server;
  private readonly sockets = new Set<Socket>();
  private behaviour: Behaviour = 'ok';

  /** Listens on every interface, because Envoy reaches it from Docker. */
  public async start(): Promise<number> {
    const server = createServer((req, res) => this.handle(req, res));

    server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '0.0.0.0', resolve);
    });

    this.server = server;

    return (server.address() as AddressInfo).port;
  }

  public async stop(): Promise<void> {
    const server = this.server;

    if (!server) {
      return;
    }

    for (const socket of this.sockets) {
      socket.destroy();
    }

    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  public reset(): void {
    this.requests.length = 0;
    this.behaviour = 'ok';
  }

  public failWithConnectionReset(): void {
    this.behaviour = 'reset';
  }

  public failWithServerError(): void {
    this.behaviour = 'error';
  }

  public hang(): void {
    this.behaviour = 'hang';
  }

  /** The single request that reached Loki; fails if there was not exactly one. */
  public onlyRequest(): RecordedRequest {
    expect(this.requests).toHaveLength(1);

    return this.requests[0];
  }

  public expectNothingForwarded(): void {
    expect(this.requests).toEqual([]);
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      this.requests.push({
        method: req.method ?? '',
        target: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });

      if (this.behaviour === 'reset') {
        req.socket.destroy();
        return;
      }

      if (this.behaviour === 'hang') {
        return;
      }

      if (this.behaviour === 'error') {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('loki internal detail');
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(EMPTY_RESULT);
    });
  }
}
