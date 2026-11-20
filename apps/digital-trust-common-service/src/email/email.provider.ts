import type { EmailKind } from './email.service';

export class EmailDeliveryError extends Error {}

export abstract class EmailProvider {
  public readonly countsTowardQuota: boolean = true;

  public abstract send(message: {
    kind: EmailKind.TENANT_INVITATION;
    to: string;
    tenantName: string;
    signInUrl: string;
  }): Promise<void>;
}
