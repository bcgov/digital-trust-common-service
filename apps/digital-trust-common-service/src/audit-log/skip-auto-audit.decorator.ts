import { SetMetadata } from '@nestjs/common';

export const SKIP_AUTO_AUDIT_KEY = 'skipAutoAudit';

/** Mark a controller or handler that already emits domain audit events. */
export const SkipAutoAudit = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_AUTO_AUDIT_KEY, true);
