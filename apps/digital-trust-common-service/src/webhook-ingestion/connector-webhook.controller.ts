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
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { API_VERSION } from '../common/constants/api-version.constants';
import { ProtocolStateChangeWorker } from '../protocol-state-change/protocol-state-change.worker';
import type { ProtocolTopic } from '../protocol-state-change/state-mapping';

import { ConnectorWebhookGuard } from './connector-webhook.guard';
import type { ConnectorWebhookRequest } from './connector-webhook.guard';

/** The wire field each topic uses to identify the exchange being updated. */
const TOPIC_EXTERNAL_ID_FIELD: Record<ProtocolTopic, string> = {
  issue_credential: 'credential_exchange_id',
  present_proof: 'presentation_exchange_id',
  connections: 'connection_id',
  revocation_registry: 'credential_exchange_id',
};

/**
 * Inbound protocol event callback shared by every connector type (Traction,
 * and in future Credo). Auth is the connector's shared secret
 * (`ConnectorWebhookGuard`), not a tenant JWT — the connector row itself
 * resolves the tenant. The body is deliberately typed as a plain object
 * rather than a class-validator DTO: the global ValidationPipe's
 * `forbidNonWhitelisted` would reject any vendor field we haven't declared,
 * and the payload is stored verbatim as Operation.result regardless.
 */
@ApiTags('webhooks')
@UseGuards(ConnectorWebhookGuard)
@Controller({
  // ACA-Py appends `/topic/{topic}/` to whatever webhook URL is registered
  // with it (see TractionWebhookRegistrar), so the registered URL is just
  // `connectors/:connectorId/webhooks` and this `topic` segment is literal.
  path: 'connectors/:connectorId/webhooks/topic/:topic',
  version: API_VERSION,
})
export class ConnectorWebhookController {
  private readonly logger = new Logger(ConnectorWebhookController.name);

  public constructor(private readonly worker: ProtocolStateChangeWorker) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Receive an inbound connector protocol state-change webhook',
  })
  @ApiParam({ name: 'connectorId', description: 'ConnectorCredential id' })
  @ApiParam({
    name: 'topic',
    description: 'Protocol topic',
    enum: Object.keys(TOPIC_EXTERNAL_ID_FIELD),
  })
  @ApiOkResponse({ description: 'Webhook accepted for async processing' })
  @ApiUnauthorizedResponse({ description: 'Webhook authentication failed' })
  public async receive(
    @Param('topic') topic: string,
    @Body() body: Record<string, unknown>,
    @Req() request: ConnectorWebhookRequest,
  ): Promise<Record<string, never>> {
    const externalIdField = TOPIC_EXTERNAL_ID_FIELD[topic as ProtocolTopic];

    // ACA-Py retries on non-2xx, so malformed/unrecognized payloads are
    // acknowledged and dropped rather than rejected.
    if (!externalIdField) {
      this.logger.debug(`Unknown webhook topic '${topic}'`);
      return {};
    }

    const externalId = body[externalIdField];
    const protocolState = body.state;

    if (typeof externalId !== 'string' || !externalId) {
      this.logger.debug(`Missing '${externalIdField}' on webhook payload`);
      return {};
    }

    if (typeof protocolState !== 'string' || !protocolState) {
      this.logger.debug("Missing 'state' on webhook payload");
      return {};
    }

    await this.worker.enqueue({
      // Guard sets tenantId from the resolved ConnectorCredential.
      tenantId: request.tenantId as string,
      topic: topic as ProtocolTopic,
      externalId,
      protocolState,
      payload: body,
    });

    return {};
  }
}
