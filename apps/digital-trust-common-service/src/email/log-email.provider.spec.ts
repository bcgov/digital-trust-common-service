import { Logger } from '@nestjs/common';

import { EmailKind } from './email.service';
import { LogEmailProvider } from './log-email.provider';

describe('LogEmailProvider', () => {
  const invitation = {
    kind: EmailKind.TENANT_INVITATION as const,
    to: 'invitee@example.test',
    tenantName: 'Example tenant',
    signInUrl: 'https://app.example.test/login?next=overview#sign-in',
  };

  afterEach(() => jest.restoreAllMocks());

  it('logs the plain-text invitation with the public sign-in link in development', async () => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      NODE_ENV: 'development',
    });
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});

    await new LogEmailProvider().send(invitation);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      "Email not sent (log-only provider): tenant-invitation\n\nYou've been invited to Example tenant\n\nSign in with the account associated with your invited email address. If you don't have an account yet, contact the administrator who invited you.\n\nSign in to accept your invitation: https://app.example.test/login",
    );
  });

  it.each(['production', 'test', undefined])(
    'omits invitation details when NODE_ENV is %s',
    async (nodeEnv) => {
      jest.replaceProperty(process, 'env', {
        ...process.env,
        NODE_ENV: nodeEnv,
      });
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => {});

      await new LogEmailProvider().send(invitation);

      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        'Email not sent (log-only provider): tenant-invitation',
      );
    },
  );
});
