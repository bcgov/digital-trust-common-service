import { createTransport } from 'nodemailer';

import { EmailDeliveryError, EmailProvider } from './email.provider';
import { renderInvitationEmail } from './invitation-email.template';

export interface SmtpEmailOptions {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  auth?: { user: string; pass: string };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function smtpFailureReason(error: unknown): string {
  const code = error instanceof Error && 'code' in error ? error.code : null;

  switch (code) {
    case 'EDNS':
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'SMTP hostname could not be resolved.';
    case 'ETLS':
      return 'SMTP TLS negotiation or certificate verification failed.';
    case 'ETIMEDOUT':
      return 'SMTP server did not respond in time.';
    case 'ECONNECTION':
    case 'ECONNREFUSED':
    case 'ESOCKET':
      return 'SMTP connection failed. Check host, port, and TLS settings.';
    case 'EAUTH':
      return 'SMTP authentication failed.';
    case 'EENVELOPE':
    case 'EMESSAGE':
      return 'SMTP server did not accept the email.';
    default:
      return 'Email provider failed to send invitation.';
  }
}

export class SmtpEmailProvider extends EmailProvider {
  private readonly transport;

  public constructor(private readonly options: SmtpEmailOptions) {
    super();
    const { host, port, secure, auth } = options;
    this.transport = createTransport({
      host,
      port,
      secure,
      requireTLS: !secure,
      auth,
    });
  }

  public async send(
    message: Parameters<EmailProvider['send']>[0],
  ): Promise<void> {
    const { to, tenantName, signInUrl } = message;
    const { subject, action, instructions, text } = renderInvitationEmail(
      tenantName,
      signInUrl,
    );

    try {
      await this.transport.sendMail({
        from: this.options.from,
        to,
        subject,
        text,
        html: `<p>${escapeHtml(subject)}</p><p>${escapeHtml(instructions)}</p><p><a href="${escapeHtml(signInUrl)}">${action}</a></p>`,
      });
    } catch (error) {
      throw new EmailDeliveryError(smtpFailureReason(error));
    }
  }
}
