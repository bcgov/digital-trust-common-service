/**
 * Canonical pg-boss queue names (ME-01).
 */
export const JOB_QUEUES = {
  CREDENTIAL_STATE_UPDATE: 'credential.state-update',
  CREDENTIAL_BULK_ITEM: 'credential.bulk-item',
  WEBHOOK_DISPATCH: 'webhook.dispatch',
  EMAIL_SEND: 'email.send',
  AUDIT_WRITE: 'audit.write',
} as const;

export type JobQueueName = (typeof JOB_QUEUES)[keyof typeof JOB_QUEUES];

export const JOB_DEAD_LETTER_QUEUES = {
  CREDENTIAL_STATE_UPDATE: 'credential.state-update.dlq',
  CREDENTIAL_BULK_ITEM: 'credential.bulk-item.dlq',
  WEBHOOK_DISPATCH: 'webhook.dispatch.dlq',
  EMAIL_SEND: 'email.send.dlq',
  AUDIT_WRITE: 'audit.write.dlq',
} as const;

export type QueueDefinition = {
  name: JobQueueName;
  deadLetter: string;
  retryLimit: number;
  retryDelay: number;
  retryBackoff: boolean;
};

export const QUEUE_DEFINITIONS: QueueDefinition[] = [
  {
    name: JOB_QUEUES.CREDENTIAL_STATE_UPDATE,
    deadLetter: JOB_DEAD_LETTER_QUEUES.CREDENTIAL_STATE_UPDATE,
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
  },
  {
    name: JOB_QUEUES.CREDENTIAL_BULK_ITEM,
    deadLetter: JOB_DEAD_LETTER_QUEUES.CREDENTIAL_BULK_ITEM,
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
  },
  {
    name: JOB_QUEUES.WEBHOOK_DISPATCH,
    deadLetter: JOB_DEAD_LETTER_QUEUES.WEBHOOK_DISPATCH,
    retryLimit: 5,
    retryDelay: 60,
    retryBackoff: true,
  },
  {
    name: JOB_QUEUES.EMAIL_SEND,
    deadLetter: JOB_DEAD_LETTER_QUEUES.EMAIL_SEND,
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
  },
  {
    name: JOB_QUEUES.AUDIT_WRITE,
    deadLetter: JOB_DEAD_LETTER_QUEUES.AUDIT_WRITE,
    retryLimit: 5,
    retryDelay: 15,
    retryBackoff: true,
  },
];
