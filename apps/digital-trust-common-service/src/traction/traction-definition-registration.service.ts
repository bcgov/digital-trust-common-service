import {
  ConnectorContext,
  DefinitionOptions,
  AnonCredsRegistrationPort,
  IssuerSelection,
  RegisteredSchema,
  RegistrationSubmission,
  ValidationError,
} from '@app/credential-ports';
import { Injectable } from '@nestjs/common';
import axios, { AxiosRequestConfig } from 'axios';

import {
  RegistrationBackendError,
  registrationErrorText,
} from '../common/registration-backend-error';

import { TractionHttpClient } from './traction-http-client.service';
import { TractionTokenManager } from './traction-token-manager.service';

interface WalletDid {
  readonly did: string;
  readonly verkey: string;
  readonly method: string;
}

interface AnonCredsSchema {
  readonly name: string;
  readonly version: string;
  readonly attrNames: string[];
  readonly issuerId: string;
}

interface AnonCredsDefinition {
  readonly issuerId: string;
  readonly schemaId: string;
  readonly tag: string;
  readonly value: { readonly revocation?: object };
}

@Injectable()
export class TractionDefinitionRegistration implements AnonCredsRegistrationPort {
  public constructor(
    private readonly http: TractionHttpClient,
    private readonly tokens: TractionTokenManager,
  ) {}

  public async resolveIssuer(
    context: ConnectorContext,
    selection?: IssuerSelection,
  ): Promise<string> {
    const wallet = await this.call<{ settings: Record<string, unknown> }>(
      context,
      '/tenant/wallet',
    );
    if (wallet.settings['wallet.type'] !== 'askar-anoncreds') {
      throw new ValidationError(['The issuer wallet must use askar-anoncreds']);
    }
    const { result: issuer } = await this.call<{ result: WalletDid | null }>(
      context,
      '/wallet/did/public',
    );
    if (
      !issuer ||
      (selection?.id && selection.id !== issuer.did) ||
      (selection?.method && selection.method !== issuer.method)
    ) {
      throw new ValidationError([
        'PUBLIC_ISSUER_DID_REQUIRED: configure a matching public issuer DID in Traction',
      ]);
    }
    const ledger = await this.call<{ verkey: string }>(
      context,
      '/ledger/did-verkey',
      { params: { did: issuer.did } },
    );
    if (issuer.verkey !== ledger.verkey) {
      throw new ValidationError([
        'Public issuer DID verification key mismatch',
      ]);
    }
    return issuer.did;
  }

  public async resolveSchema(
    context: ConnectorContext,
    id: string,
  ): Promise<RegisteredSchema> {
    const resolved = await this.call<{
      schema_id: string;
      schema: AnonCredsSchema;
    }>(context, `/anoncreds/schema/${encodeURIComponent(id)}`);
    if (!resolved.schema || resolved.schema_id !== id) {
      throw new ValidationError(['Schema could not be resolved']);
    }
    return {
      id,
      definition: {
        schema_name: resolved.schema.name,
        schema_version: resolved.schema.version,
        attr_names: resolved.schema.attrNames,
      },
    };
  }

  public async findSchema(
    context: ConnectorContext,
    issuerId: string,
    definition: Record<string, unknown>,
  ): Promise<RegisteredSchema | null> {
    const result = await this.call<{ schema_ids: string[] }>(
      context,
      '/anoncreds/schemas',
      {
        params: {
          schema_issuer_id: this.toRegistrationIssuerId(issuerId),
          schema_name: definition.schema_name,
          schema_version: definition.schema_version,
        },
      },
    );
    if (result.schema_ids.length > 1) {
      throw new ValidationError(['Ambiguous schema registration']);
    }
    if (!result.schema_ids.length) {
      return null;
    }
    const schema = await this.resolveSchema(context, result.schema_ids[0]);
    const actual = schema.definition.attr_names;
    const expected = definition.attr_names;
    if (
      !Array.isArray(actual) ||
      !Array.isArray(expected) ||
      actual.length !== expected.length ||
      actual.some((name) => !expected.includes(name))
    ) {
      throw new ValidationError([
        'Existing schema name/version has different attributes',
      ]);
    }
    return schema;
  }

  public async publishSchema(
    context: ConnectorContext,
    issuerId: string,
    definition: Record<string, unknown>,
  ): Promise<RegistrationSubmission> {
    const result = await this.call<unknown>(context, '/anoncreds/schema', {
      method: 'POST',
      data: {
        schema: {
          issuerId: this.toRegistrationIssuerId(issuerId),
          name: definition.schema_name,
          version: definition.schema_version,
          attrNames: definition.attr_names,
        },
      },
    });
    return this.submission(result, 'schema', context);
  }

  public async findDefinition(
    context: ConnectorContext,
    issuerId: string,
    schemaId: string,
    options: DefinitionOptions,
  ): Promise<string | null> {
    const registrationIssuerId = this.toRegistrationIssuerId(issuerId);
    const result = await this.call<{ credential_definition_ids: string[] }>(
      context,
      '/anoncreds/credential-definitions',
      { params: { issuer_id: registrationIssuerId, schema_id: schemaId } },
    );
    const matches: string[] = [];
    for (const id of result.credential_definition_ids) {
      const { credential_definition: definition } = await this.call<{
        credential_definition: AnonCredsDefinition;
      }>(context, `/anoncreds/credential-definition/${encodeURIComponent(id)}`);
      if (definition.tag !== options.tag) {
        continue;
      }
      if (
        definition.issuerId !== registrationIssuerId ||
        definition.schemaId !== schemaId ||
        Boolean(definition.value.revocation) !==
          options.status.revocation.enabled
      ) {
        throw new ValidationError([
          'Existing credential definition does not match registration options',
        ]);
      }
      matches.push(id);
    }
    if (matches.length > 1) {
      throw new ValidationError([
        'Ambiguous credential definition registration',
      ]);
    }
    return matches[0] ?? null;
  }

  public async publishDefinition(
    context: ConnectorContext,
    issuerId: string,
    schemaId: string,
    options: DefinitionOptions,
  ): Promise<RegistrationSubmission> {
    const result = await this.call<unknown>(
      context,
      '/anoncreds/credential-definition',
      {
        method: 'POST',
        data: {
          credential_definition: {
            issuerId: this.toRegistrationIssuerId(issuerId),
            schemaId,
            tag: options.tag,
          },
          options: {
            support_revocation: options.status.revocation.enabled,
          },
          wait_for_revocation_setup: false,
        },
      },
    );
    return this.submission(result, 'credential_definition', context);
  }

  public async verifyRevocation(
    context: ConnectorContext,
    definitionId: string,
  ): Promise<boolean> {
    let record: {
      state: string;
      revoc_reg_id: string;
      max_cred_num: number;
      cred_def_id: string;
    };
    try {
      const response = await this.call<{ result: typeof record }>(
        context,
        `/anoncreds/revocation/active-registry/${encodeURIComponent(definitionId)}`,
      );
      record = response.result;
    } catch (error) {
      if (error instanceof RegistrationBackendError && error.status === 404) {
        return false;
      }
      throw error;
    }
    if (
      record.cred_def_id !== definitionId ||
      record.state !== 'finished' ||
      !record.revoc_reg_id ||
      !Number.isSafeInteger(record.max_cred_num) ||
      record.max_cred_num <= 0
    ) {
      return false;
    }
    const path = `/anoncreds/revocation/registry/${encodeURIComponent(record.revoc_reg_id)}`;
    const delta = await this.call<{
      rev_reg_delta: { value?: { accum?: string } };
    }>(context, `${path}/issued/indy_recs`);
    const issued = await this.call<{ result: number }>(
      context,
      `${path}/issued`,
    );
    if (
      !delta.rev_reg_delta?.value?.accum ||
      !Number.isSafeInteger(issued.result) ||
      issued.result < 0 ||
      issued.result >= record.max_cred_num
    ) {
      return false;
    }
    return true;
  }

  private toRegistrationIssuerId(issuerId: string): string {
    // BUG: ACA-Py 1.6.0's legacy Indy registrar rejects the wallet's
    // did:indy:<identifier> representation during registrar selection.
    // TODO: Remove this mapping when the deployed registrar supports it.
    // Keep the canonical wallet DID; never strip a ledger namespace.
    const legacyIndy = /^did:indy:([1-9A-HJ-NP-Za-km-z]{21,22})$/.exec(
      issuerId,
    );
    if (legacyIndy) {
      return legacyIndy[1];
    }
    if (issuerId.startsWith('did:indy:')) {
      throw new ValidationError([
        'The legacy Indy registrar requires an unnamespaced issuer identifier',
      ]);
    }
    return issuerId;
  }

  private submission(
    response: unknown,
    artifact: 'schema' | 'credential_definition',
    context: ConnectorContext,
  ): RegistrationSubmission {
    const result = this.record(response);
    const artifactState = this.record(result?.[`${artifact}_state`]);
    const rawState = artifactState?.state;
    const state = this.registrationState(rawState);
    const identifier = (value: unknown): string | undefined =>
      typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 2048 &&
      ![...value].some(
        (character) =>
          character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
      )
        ? value
        : undefined;
    const id = identifier(artifactState?.[`${artifact}_id`]);
    const jobId = identifier(result?.job_id);
    const txn = this.record(this.record(result?.registration_metadata)?.txn);
    const transactionId = identifier(txn?.transaction_id);
    if (!state) {
      throw new RegistrationBackendError(
        undefined,
        'INVALID_REGISTRATION_RESPONSE',
        'Backend returned an unrecognized artifact registration state',
        true,
      );
    }
    if (state === 'failed') {
      const reason = registrationErrorText(
        artifactState?.reason,
        Object.values(context.credentials).filter(
          (value): value is string => typeof value === 'string',
        ),
      );
      return {
        state,
        id,
        jobId,
        transactionId,
        backendCode: 'REGISTRATION_REJECTED',
        detail: reason ?? 'Backend reported artifact registration failure',
      };
    }
    if ((state === 'finished' && !id) || (!id && !jobId && !transactionId)) {
      throw new RegistrationBackendError(
        undefined,
        'INVALID_REGISTRATION_RESPONSE',
        'Backend registration response has no usable correlation identifier',
        true,
      );
    }
    return { state, id, jobId, transactionId };
  }

  private registrationState(
    state: unknown,
  ): RegistrationSubmission['state'] | undefined {
    if (state === 'finished' || state === 'action' || state === 'wait') {
      return state;
    }
    if (
      state === 'failed' ||
      state === 'transaction_refused' ||
      state === 'transaction_cancelled'
    ) {
      return 'failed';
    }
    if (state === 'transaction_created' || state === 'request_received') {
      return 'action';
    }
    if (
      state === 'request_sent' ||
      state === 'transaction_acked' ||
      state === 'transaction_endorsed' ||
      state === 'transaction_resent' ||
      state === 'transaction_resent_received'
    ) {
      return 'wait';
    }
    return undefined;
  }

  private record(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private async call<T>(
    context: ConnectorContext,
    path: string,
    config: AxiosRequestConfig = {},
  ): Promise<T> {
    let token: string | undefined;
    try {
      token = await this.tokens.getToken(context);
      const response = await this.http.request<T>(
        {
          ...config,
          url: `${context.endpointUrl}${path}`,
          headers: { Authorization: `Bearer ${token}` },
          maxRedirects: 0,
        },
        config.method !== 'POST',
      );
      return response.data;
    } catch (error) {
      if (!axios.isAxiosError<unknown>(error)) {
        throw error;
      }
      const body = this.record(error.response?.data);
      const nested = this.record(body?.error);
      const secrets = [
        token ?? '',
        ...Object.values(context.credentials).filter(
          (value): value is string => typeof value === 'string',
        ),
      ];
      const backendCode = registrationErrorText(
        nested?.code ?? body?.code,
        secrets,
      );
      const reason =
        body?.reason ??
        nested?.message ??
        body?.detail ??
        body?.message ??
        (typeof body?.error === 'string' ? body.error : error.response?.data);
      throw new RegistrationBackendError(
        error.response?.status,
        backendCode?.match(/^[A-Z][A-Z0-9_]{0,99}$/)?.[0],
        error.response?.status === 401 || error.response?.status === 403
          ? 'Backend authentication or authorization failed'
          : (registrationErrorText(reason, secrets) ??
              (error.response
                ? 'Backend rejected the registration request'
                : 'Backend request did not return a response; reconcile any submitted artifacts')),
      );
    }
  }
}
