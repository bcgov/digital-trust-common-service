import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { API_VERSION } from '../common/constants/api-version.constants';
import { ConnectorType } from '../connection/connection.entity';
import { ProtocolStateChangeWorker } from '../protocol-state-change/protocol-state-change.worker';
import type { ProtocolTopic } from '../protocol-state-change/state-mapping';

import { ConnectorWebhookGuard } from './connector-webhook.guard';
import type { ConnectorWebhookRequest } from './connector-webhook.guard';

/**
 * Traction/ACA-Py's webhook URL topic segment is its own short name, not the
 * generic ProtocolTopic used internally — it PUTs to
 * `/topic/issue_credential_v2_0/`, not `/topic/issue_credential/`. Maps a
 * connector's raw wire topic to the ProtocolTopic used by
 * CONNECTOR_TOPIC_EXTERNAL_ID_FIELD, TOPIC_OPERATION_TYPES, and the
 * state-change worker.
 */
const CONNECTOR_WIRE_TOPIC_MAP: Record<
  ConnectorType,
  Partial<Record<string, ProtocolTopic>>
> = {
  [ConnectorType.TRACTION]: {
    issue_credential_v2_0: 'issue_credential',
    present_proof_v2_0: 'present_proof',
    connections: 'connections',
    issuer_cred_rev: 'revocation_registry',
  },
  [ConnectorType.CREDO]: {},
};

const KNOWN_WIRE_TOPICS = Array.from(
  new Set(
    Object.values(CONNECTOR_WIRE_TOPIC_MAP).flatMap((map) => Object.keys(map)),
  ),
);

/**
 * The wire field each topic uses to identify the exchange being updated, per
 * connector type — ACA-Py/Traction's shortened `_ex_id`/`_rev_id` field names
 * (e.g. `cred_ex_id`, not `credential_exchange_id`) don't necessarily match
 * what a future connector type (e.g. Credo) sends for the same topic.
 */
const CONNECTOR_TOPIC_EXTERNAL_ID_FIELD: Record<
  ConnectorType,
  Partial<Record<ProtocolTopic, string>>
> = {
  [ConnectorType.TRACTION]: {
    issue_credential: 'cred_ex_id',
    present_proof: 'pres_ex_id',
    connections: 'connection_id',
    revocation_registry: 'cred_ex_id',
  },
  [ConnectorType.CREDO]: {},
};

const OUTCOME_ACCEPTED = 'accepted';
const OUTCOME_DROPPED = 'dropped';

/**
 * Why a delivery was acknowledged without being enqueued. A closed set, so a
 * log search can count drops by reason without the reason string coming from
 * the payload: `unknown_topic` is a topic this service does not consume,
 * `no_external_id_field` a mapped topic with no correlation field configured
 * for it, and the last two a known topic whose payload was missing the field
 * the state change is correlated and applied by.
 */
const DROP_MISSING_EXTERNAL_ID = 'missing_external_id';
const DROP_MISSING_STATE = 'missing_state';
const DROP_NO_EXTERNAL_ID_FIELD = 'no_external_id_field';
const DROP_UNKNOWN_TOPIC = 'unknown_topic';

/**
 * Inbound protocol event callback shared by every connector type (Traction,
 * and in future Credo). Auth is the connector's shared secret
 * (`ConnectorWebhookGuard`), not a tenant JWT — the connector row itself
 * resolves the tenant. The body is deliberately typed as a plain object
 * rather than a class-validator DTO: the global ValidationPipe's
 * `forbidNonWhitelisted` would reject any vendor field we haven't declared,
 * and the raw payload is forwarded to the worker for processing.
 *
 * Every delivery emits exactly one event naming what arrived and whether it
 * was enqueued or dropped — see docs/ARCHITECTURE.md, "Webhook ingestion
 * events". The payload itself is never a field on any of them.
 */
@ApiTags('webhooks')
@UseGuards(ConnectorWebhookGuard)
@Controller({
  // ACA-Py appends `/topic/{topic}/` to whatever webhook URL is registered
  // with it (see TractionWebhookRegistrar), so the registered URL is just
  // `connectors/:connectorId/webhooks/traction` and this `topic` segment is
  // literal.
  path: 'connectors/:connectorId/webhooks/traction/topic/:topic',
  version: API_VERSION,
})
export class TractionWebhookController {
  private readonly logger = new Logger(TractionWebhookController.name);

  public constructor(private readonly worker: ProtocolStateChangeWorker) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Receive an inbound connector protocol state-change webhook',
  })
  @ApiHeader({
    name: 'X-Api-Key',
    description: 'Shared webhook secret configured on the connector',
  })
  @ApiParam({ name: 'connectorId', description: 'ConnectorCredential id' })
  @ApiParam({
    name: 'topic',
    description: "Connector's wire-level webhook topic",
    enum: KNOWN_WIRE_TOPICS,
  })
  @ApiBody({
    description: 'Traction/ACA-Py webhook payload (topic-dependent structure)',
    schema: { type: 'object' },
  })
  @ApiOkResponse({ description: 'Webhook accepted for async processing' })
  @ApiUnauthorizedResponse({ description: 'Webhook authentication failed' })
  public async receive(
    @Param('topic') wireTopic: string,
    @Body() body: Record<string, unknown>,
    @Req() request: ConnectorWebhookRequest,
  ): Promise<Record<string, never>> {
    const connectorType = request.connectorType as ConnectorType;
    const connectorId = request.connectorId as string;
    const topic = CONNECTOR_WIRE_TOPIC_MAP[connectorType]?.[wireTopic];

    // ACA-Py retries on non-2xx, so malformed/unrecognized payloads are
    // acknowledged and dropped rather than rejected.
    if (!topic) {
      // Debug rather than warn: ACA-Py fans every topic it knows out to the
      // one registered URL (see TractionWebhookRegistrar), so the topics this
      // service does not consume arrive constantly and are not a fault.
      this.logger.debug(
        {
          connector_id: connectorId,
          connector_type: connectorType,
          drop_reason: DROP_UNKNOWN_TOPIC,
          outcome: OUTCOME_DROPPED,
          wire_topic: wireTopic,
        },
        'webhook dropped',
      );

      return {};
    }

    const externalIdField =
      CONNECTOR_TOPIC_EXTERNAL_ID_FIELD[connectorType]?.[topic];

    if (!externalIdField) {
      this.logger.warn(
        {
          connector_id: connectorId,
          connector_type: connectorType,
          drop_reason: DROP_NO_EXTERNAL_ID_FIELD,
          outcome: OUTCOME_DROPPED,
          topic,
          wire_topic: wireTopic,
        },
        'webhook dropped',
      );

      return {};
    }

    const externalId = body?.[externalIdField];
    const protocolState = body?.state;

    // A topic this service does consume, arriving without the field the state
    // change is correlated or applied by, is a real mismatch between what
    // ACA-Py sends and what is mapped here — and the state change is lost,
    // since nothing retries. Warn, unlike the unknown topic above.
    if (typeof externalId !== 'string' || !externalId) {
      this.logger.warn(
        {
          connector_id: connectorId,
          connector_type: connectorType,
          drop_reason: DROP_MISSING_EXTERNAL_ID,
          outcome: OUTCOME_DROPPED,
          topic,
          wire_topic: wireTopic,
        },
        'webhook dropped',
      );

      return {};
    }

    if (typeof protocolState !== 'string' || !protocolState) {
      this.logger.warn(
        {
          connector_id: connectorId,
          connector_type: connectorType,
          drop_reason: DROP_MISSING_STATE,
          external_id: externalId,
          outcome: OUTCOME_DROPPED,
          topic,
          wire_topic: wireTopic,
        },
        'webhook dropped',
      );

      return {};
    }

    await this.worker.enqueue({
      // Guard sets tenantId from the resolved ConnectorCredential.
      tenantId: request.tenantId as string,
      topic,
      externalId,
      protocolState,
      payload: body,
    });

    // Every field is named explicitly and the payload is never among them:
    // `tenant_id`, `request_id`, and `operation_id` are attached by the pino
    // mixin from the request context, which the guard has already resolved
    // the tenant into, so nothing is threaded through for them.
    this.logger.log(
      {
        connector_id: connectorId,
        connector_type: connectorType,
        external_id: externalId,
        outcome: OUTCOME_ACCEPTED,
        protocol_state: protocolState,
        topic,
        wire_topic: wireTopic,
      },
      'webhook accepted',
    );

    return {};
  }
}
