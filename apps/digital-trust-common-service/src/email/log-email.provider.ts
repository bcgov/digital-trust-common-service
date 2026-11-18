import { Logger } from '@nestjs/common';

import { EmailProvider } from './email.provider';
import { renderInvitationEmail } from './invitation-email.template';

export class LogEmailProvider extends EmailProvider {
  public override readonly countsTowardQuota = false;

  private readonly logger = new Logger(LogEmailProvider.name);

  public send({
    kind,
    tenantName,
    signInUrl,
  }: Parameters<EmailProvider['send']>[0]): Promise<void> {
    const message = `Email not sent (log-only provider): ${kind}`;
    if (process.env.NODE_ENV === 'development') {
      const url = new URL(signInUrl);
      const { text } = renderInvitationEmail(
        tenantName,
        `${url.origin}${url.pathname}`,
      );
      this.logger.log(`${message}\n\n${text}`);
    } else {
      this.logger.log(message);
    }
    return Promise.resolve();
  }
}
