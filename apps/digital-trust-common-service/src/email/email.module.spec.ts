import { ConfigService } from '@nestjs/config';

import { selectEmailProvider } from './email.module';
import { LogEmailProvider } from './log-email.provider';
import { SmtpEmailProvider } from './smtp-email.provider';

describe('selectEmailProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  function select(
    driver?: string,
    nodeEnv?: string,
    smtp: NodeJS.ProcessEnv = {},
  ) {
    jest.replaceProperty(process, 'env', {
      ...smtp,
      MAIL_DRIVER: driver,
      NODE_ENV: nodeEnv,
    });
    return selectEmailProvider(new ConfigService());
  }

  it.each([undefined, ''])('disables delivery for driver %s', (driver) => {
    expect(select(driver, 'development')).toBeNull();
  });

  it('selects log delivery in development', () => {
    expect(select('log', 'development')).toBeInstanceOf(LogEmailProvider);
  });

  it.each(['production', 'test', undefined])(
    'rejects log mode with NODE_ENV=%s',
    (nodeEnv) => {
      expect(() => select('log', nodeEnv)).toThrow(
        'requires NODE_ENV=development',
      );
    },
  );

  it('rejects unsupported drivers', () => {
    expect(() => select('sendgrid', 'development')).toThrow(
      'Unsupported MAIL_DRIVER',
    );
  });

  const smtp = {
    SMTP_HOST: 'smtp.example.test',
    SMTP_FROM: 'sender@example.test',
  };

  it('binds SMTP without connecting to the relay at startup', () => {
    expect(select('smtp', 'production', smtp)).toBeInstanceOf(
      SmtpEmailProvider,
    );
  });

  it('requires a host and sender for SMTP', () => {
    expect(() => select('smtp')).toThrow('requires SMTP_HOST and SMTP_FROM');
  });

  it.each([
    [{ SMTP_PORT: '65536' }, 'SMTP_PORT'],
    [{ SMTP_SECURE: 'yes' }, 'SMTP_SECURE'],
    [{ SMTP_USER: 'relay-user' }, 'Set both SMTP_USER and SMTP_PASSWORD'],
  ])('rejects invalid SMTP configuration %j', (overrides, error) => {
    expect(() =>
      select('smtp', 'development', { ...smtp, ...overrides }),
    ).toThrow(error);
  });
});
