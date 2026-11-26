import { createTransport } from 'nodemailer';

import { EmailDeliveryError } from './email.provider';
import { EmailKind } from './email.service';
import { SmtpEmailProvider } from './smtp-email.provider';

jest.mock('nodemailer');

describe('SmtpEmailProvider', () => {
  const sendMail = jest.fn();
  const options = {
    host: 'smtp.example.test',
    port: 587,
    secure: false,
    from: 'sender@example.test',
  };
  const message = {
    kind: EmailKind.TENANT_INVITATION as const,
    to: 'invitee@example.test',
    tenantName: 'Example <Tenant>',
    signInUrl: 'https://app.example.test/login?one=1&two=2',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(createTransport).mockReturnValue({
      sendMail,
    });
  });

  it('requires STARTTLS and sends both invitation formats', async () => {
    const provider = new SmtpEmailProvider(options);

    await provider.send(message);

    expect(createTransport).toHaveBeenCalledWith({
      host: options.host,
      port: options.port,
      secure: false,
      requireTLS: true,
      auth: undefined,
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: options.from,
      to: message.to,
      subject: `You've been invited to ${message.tenantName}`,
      text: expect.stringContaining(message.signInUrl),
      html: expect.stringMatching(/Example &lt;Tenant&gt;.*one=1&amp;two=2/),
    });
  });

  it.each([
    ['EDNS', 'SMTP hostname could not be resolved.'],
    ['ETLS', 'SMTP TLS negotiation or certificate verification failed.'],
    ['EAUTH', 'SMTP authentication failed.'],
    ['EENVELOPE', 'SMTP server did not accept the email.'],
    ['unrecognized', 'Email provider failed to send invitation.'],
  ])('replaces %s errors with a safe diagnostic', async (code, reason) => {
    const provider = new SmtpEmailProvider(options);
    const response = `Rejected ${message.to}`;
    const error = Object.assign(new Error(response), { code, response });
    sendMail.mockRejectedValueOnce(error);

    await expect(provider.send(message)).rejects.toStrictEqual(
      new EmailDeliveryError(reason),
    );
  });
});
