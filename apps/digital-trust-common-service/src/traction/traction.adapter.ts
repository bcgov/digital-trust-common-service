import {
  AdapterError,
  AgentAdapter,
  Connection,
  ConnectionFilters,
  ConnectionState,
  ConnectorContext,
  ConnectorType,
  ConnectorUnavailableError,
  CredentialExchange,
  CredentialFormat,
  Invitation,
  InvitationOptions,
  OfferCredentialRequest,
  PresentationExchange,
  PresentationRequest,
  RevocationResult,
  SupportedFormats,
  TimeoutError,
  ValidationError,
} from '@app/credential-ports';
import {
  Injectable,
  Logger,
  NotImplementedException,
  OnModuleInit,
} from '@nestjs/common';
import axios from 'axios';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';

import { TractionHttpClient } from './traction-http-client.service';
import { TractionTokenManager } from './traction-token-manager.service';

// Fixed Out-of-Band invitation parameters. Not exposed on InvitationOptions —
// this connector currently only speaks DID Exchange 1.1 over OOB 1.1.
const OOB_HANDSHAKE_PROTOCOLS = ['https://didcomm.org/didexchange/1.1'];
const OOB_ACCEPT = ['didcomm/aip1', 'didcomm/aip2;env=rfc19'];
const OOB_PROTOCOL_VERSION = '1.1';

interface TractionCreateInvitationResponse {
  readonly invi_msg_id: string;
  readonly invitation_url: string;
  // ACA-Py's out-of-band record id. Purely internal OOB bookkeeping — it
  // never appears on the resulting connection record, so it is not a valid
  // stand-in for a connection id (unlike invi_msg_id, which the eventual
  // connection record echoes back as invitation_msg_id).
  readonly oob_id: string;
}

// ACA-Py's out-of-band receive-invitation response — an out-of-band record,
// not a connection record. Its own `state` tracks the OOB record's lifecycle
// (e.g. "initial", "deleted"), not the resulting connection's state, so only
// `connection_id` is used from it; the connection itself is fetched
// separately once accepted.
interface TractionReceiveInvitationResponse {
  readonly connection_id: string;
}

// ACA-Py connection record (GET /connections, GET /connections/{id}). Its
// `state` values (invitation, request, response, active, completed, error,
// ...) are the same vocabulary as our ConnectionState enum. `invitation_msg_id`
// echoes back the `invi_msg_id` from the create-invitation call that
// produced this connection, when it originated from one.
interface TractionConnectionRecord {
  readonly connection_id: string;
  readonly state: string;
  readonly alias?: string;
  readonly their_label?: string;
  readonly invitation_msg_id?: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface TractionConnectionListResponse {
  readonly results: readonly TractionConnectionRecord[];
}

/**
 * AgentAdapter implementation for the Traction (ACA-Py multitenant) backend.
 * Registers itself with the AdapterRegistry at module init so tenants whose
 * connector_type is 'traction' resolve to this instance.
 *
 * Port method bodies are stubbed pending per-port implementations. Every
 * method not yet implemented rejects with NotImplementedException.
 */
@Injectable()
export class TractionAdapter implements AgentAdapter, OnModuleInit {
  private readonly logger = new Logger(TractionAdapter.name);

  public readonly connectorType = ConnectorType.Traction;

  public readonly supportedFormats: SupportedFormats = [
    CredentialFormat.AnonCreds,
  ];

  public constructor(
    private readonly adapterRegistry: AdapterRegistry,
    private readonly httpClient: TractionHttpClient,
    private readonly tokenManager: TractionTokenManager,
  ) {}

  public onModuleInit(): void {
    this.adapterRegistry.register(this);
  }

  public offerCredential(
    _context: ConnectorContext,
    _req: OfferCredentialRequest,
  ): Promise<CredentialExchange> {
    return Promise.reject(this.notImplemented('offerCredential'));
  }

  public getExchange(
    _context: ConnectorContext,
    _id: string,
  ): Promise<CredentialExchange> {
    return Promise.reject(this.notImplemented('getExchange'));
  }

  public requestPresentation(
    _context: ConnectorContext,
    _req: PresentationRequest,
  ): Promise<PresentationExchange> {
    return Promise.reject(this.notImplemented('requestPresentation'));
  }

  public getPresentation(
    _context: ConnectorContext,
    _id: string,
  ): Promise<PresentationExchange> {
    return Promise.reject(this.notImplemented('getPresentation'));
  }

  public acceptOffer(
    _context: ConnectorContext,
    _exchangeId: string,
  ): Promise<CredentialExchange> {
    return Promise.reject(this.notImplemented('acceptOffer'));
  }

  public rejectOffer(
    _context: ConnectorContext,
    _exchangeId: string,
  ): Promise<void> {
    return Promise.reject(this.notImplemented('rejectOffer'));
  }

  public async createInvitation(
    context: ConnectorContext,
    opts: InvitationOptions,
  ): Promise<Invitation> {
    const token = await this.tokenManager.getToken(context);

    try {
      const response =
        await this.httpClient.request<TractionCreateInvitationResponse>({
          method: 'POST',
          url: `${context.endpointUrl}/out-of-band/create-invitation`,
          params: { multi_use: opts.multiUse ?? false },
          headers: { Authorization: `Bearer ${token}` },
          data: {
            accept: OOB_ACCEPT,
            alias: opts.alias ?? '',
            goal: '',
            goal_code: opts.goalCode ?? '',
            handshake_protocols: OOB_HANDSHAKE_PROTOCOLS,
            my_label: opts.label ?? '',
            protocol_version: OOB_PROTOCOL_VERSION,
            use_public_did: false,
          },
        });

      return {
        invitationId: response.data.invi_msg_id,
        invitationUrl: response.data.invitation_url,
      };
    } catch (error) {
      throw this.mapHttpError(error, context);
    }
  }

  public async acceptInvitation(
    context: ConnectorContext,
    url: string,
  ): Promise<Connection> {
    const invitation = this.decodeInvitationUrl(url);
    const token = await this.tokenManager.getToken(context);

    try {
      const response =
        await this.httpClient.request<TractionReceiveInvitationResponse>({
          method: 'POST',
          url: `${context.endpointUrl}/out-of-band/receive-invitation`,
          headers: { Authorization: `Bearer ${token}` },
          data: invitation,
        });

      return await this.fetchConnection(
        context,
        token,
        response.data.connection_id,
      );
    } catch (error) {
      throw this.mapHttpError(error, context);
    }
  }

  public async list(
    context: ConnectorContext,
    filters: ConnectionFilters,
  ): Promise<Connection[]> {
    const token = await this.tokenManager.getToken(context);

    try {
      const response =
        await this.httpClient.request<TractionConnectionListResponse>({
          method: 'GET',
          url: `${context.endpointUrl}/connections`,
          headers: { Authorization: `Bearer ${token}` },
          params: {
            alias: filters.alias,
            state: filters.state,
            limit: filters.limit,
            offset: filters.offset,
          },
        });

      return response.data.results.map((record) => this.toConnection(record));
    } catch (error) {
      throw this.mapHttpError(error, context);
    }
  }

  public async getById(
    context: ConnectorContext,
    id: string,
  ): Promise<Connection> {
    const token = await this.tokenManager.getToken(context);

    try {
      return await this.fetchConnection(context, token, id);
    } catch (error) {
      throw this.mapHttpError(error, context);
    }
  }

  public revoke(
    _context: ConnectorContext,
    _credentialId: string,
  ): Promise<RevocationResult> {
    return Promise.reject(this.notImplemented('revoke'));
  }

  public batchRevoke(
    _context: ConnectorContext,
    _ids: readonly string[],
  ): Promise<RevocationResult[]> {
    return Promise.reject(this.notImplemented('batchRevoke'));
  }

  private notImplemented(method: string): NotImplementedException {
    this.logger.warn(`${method} called before implementation landed`);

    return new NotImplementedException(
      `TractionAdapter.${method} is not yet implemented`,
    );
  }

  /**
   * Extracts the base64url-encoded invitation JSON out of an OOB invitation
   * URL's `oob` query parameter — this is the body ACA-Py's
   * /out-of-band/receive-invitation endpoint expects, not the URL itself.
   */
  private decodeInvitationUrl(url: string): Record<string, unknown> {
    let oobParam: string | null;

    try {
      oobParam = new URL(url).searchParams.get('oob');
    } catch {
      throw new ValidationError(
        [`'${url}' is not a valid invitation URL`],
        'Invalid invitation URL',
      );
    }

    if (!oobParam) {
      throw new ValidationError(
        [`'${url}' is missing an 'oob' query parameter`],
        'Invalid invitation URL',
      );
    }

    try {
      return JSON.parse(
        Buffer.from(oobParam, 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
    } catch {
      throw new ValidationError(
        ["the invitation URL's 'oob' parameter is not valid base64url JSON"],
        'Invalid invitation URL',
      );
    }
  }

  private async fetchConnection(
    context: ConnectorContext,
    token: string,
    connectionId: string,
  ): Promise<Connection> {
    const response = await this.httpClient.request<TractionConnectionRecord>({
      method: 'GET',
      url: `${context.endpointUrl}/connections/${connectionId}`,
      headers: { Authorization: `Bearer ${token}` },
    });

    return this.toConnection(response.data);
  }

  private toConnection(record: TractionConnectionRecord): Connection {
    return {
      id: record.connection_id,
      state: record.state as ConnectionState,
      alias: record.alias,
      protocol: 'didcomm-v1',
      theirLabel: record.their_label,
      invitationId: record.invitation_msg_id,
      createdAt: record.created_at,
      updatedAt: record.updated_at,
    };
  }

  /**
   * Maps a raw HTTP-layer failure (an AxiosError, or a cockatiel
   * BrokenCircuitError once the circuit is open) to the AdapterError family
   * the port contract documents. A 4xx other than 429 is a bad request we
   * won't get anywhere by retrying, so it maps to ValidationError; anything
   * else reaching here has already exhausted retries in TractionHttpClient.
   */
  private mapHttpError(
    error: unknown,
    context: ConnectorContext,
  ): AdapterError {
    if (error instanceof AdapterError) {
      return error;
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;

      if (status !== undefined && status !== 429 && status < 500) {
        return new ValidationError(
          [error.message],
          'Traction rejected the request',
        );
      }

      if (error.code === 'ECONNABORTED') {
        return new TimeoutError(error.message, {
          connectorId: context.connectorId,
        });
      }
    }

    const message = error instanceof Error ? error.message : String(error);

    return new ConnectorUnavailableError(message, {
      connectorId: context.connectorId,
    });
  }
}
