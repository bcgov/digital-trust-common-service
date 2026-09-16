import { JOB_QUEUES } from '@app/pg-boss';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'pg-boss';

import { JobsService } from '../jobs/jobs.service';

import { ProtocolStateChangeService } from './protocol-state-change.service';
import { ProtocolTopic } from './state-mapping';

/**
 * Raw payload enqueued for every inbound agent protocol event. Named
 * generically because issue-credential, present-proof, connections, and
 * revocation-registry are all Aries RFC "protocols" — this is not
 * credential-specific, hence the module living outside `credential/`.
 * This is the contract the (not yet built) webhook ingestion endpoint must
 * produce.
 */
export type ProtocolStateChangeJobData = {
  tenantId: string;
  topic: ProtocolTopic;
  externalId: string;
  protocolState: string;
  payload: Record<string, unknown>;
};

const KNOWN_TOPICS: ReadonlySet<string> = new Set<ProtocolTopic>([
  'issue_credential',
  'present_proof',
  'connections',
  'revocation_registry',
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ProtocolStateChangeWorker implements OnModuleInit {
  private readonly logger = new Logger(ProtocolStateChangeWorker.name);

  public constructor(
    private readonly jobsService: JobsService,
    private readonly service: ProtocolStateChangeService,
    private readonly config: ConfigService,
  ) {}

  public async onModuleInit(): Promise<void> {
    const workersEnabled =
      this.config.get<string>('PG_BOSS_WORKERS_ENABLED', 'true') !== 'false';

    await this.jobsService.registerWorker<ProtocolStateChangeJobData>(
      JOB_QUEUES.PROTOCOL_STATE_CHANGE,
      async (job) => this.handle(job),
      { enabled: workersEnabled, batchSize: 5 },
    );
  }

  public async handle(job: Job<ProtocolStateChangeJobData>): Promise<void> {
    const data = this.assertValidPayload(job.data);
    await this.service.process(data);
    this.logger.debug(
      `Processed protocol.state-change job ${job.id} (${data.topic}/${data.protocolState})`,
    );
  }

  /** Helper for producers / tests to enqueue a protocol.state-change job. */
  public enqueue(data: ProtocolStateChangeJobData): Promise<string | null> {
    return this.jobsService.publish(JOB_QUEUES.PROTOCOL_STATE_CHANGE, data);
  }

  private assertValidPayload(
    data: ProtocolStateChangeJobData | undefined,
  ): ProtocolStateChangeJobData {
    if (
      !data?.tenantId ||
      !data.topic ||
      !data.externalId ||
      !data.protocolState ||
      !data.payload
    ) {
      throw new Error('Invalid protocol.state-change payload');
    }

    if (!UUID_RE.test(data.tenantId)) {
      throw new Error('Invalid protocol.state-change payload');
    }

    if (!KNOWN_TOPICS.has(data.topic)) {
      throw new Error('Invalid protocol.state-change payload');
    }

    // `!data.payload` above only rejects falsy values — a string or array
    // payload would still pass through and later be persisted as
    // Operation.result, which the contract and response schema document as
    // a plain object.
    if (typeof data.payload !== 'object' || Array.isArray(data.payload)) {
      throw new Error('Invalid protocol.state-change payload');
    }

    return data;
  }
}
