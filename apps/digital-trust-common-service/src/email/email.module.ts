import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { JobsModule } from '../jobs/jobs.module';
import { TenantUser } from '../tenant-user/tenant-user.entity';
import { TenantUserRepository } from '../tenant-user/tenant-user.repository';

import { EmailSendQuotaRepository } from './email-send-quota.repository';
import { EmailProvider } from './email.provider';
import { EmailService } from './email.service';
import { EmailWorker } from './email.worker';
import { LogEmailProvider } from './log-email.provider';
import { SmtpEmailProvider } from './smtp-email.provider';

function createSmtpEmailProvider(config: ConfigService): SmtpEmailProvider {
  const host = config.get<string>('SMTP_HOST')?.trim();
  const from = config.get<string>('SMTP_FROM')?.trim();
  if (!host || !from) {
    throw new Error('MAIL_DRIVER=smtp requires SMTP_HOST and SMTP_FROM.');
  }

  const port = Number(config.get<string>('SMTP_PORT', '587'));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('SMTP_PORT must be an integer between 1 and 65535.');
  }

  const secure = config.get<string>('SMTP_SECURE', 'false');
  if (secure !== 'true' && secure !== 'false') {
    throw new Error('SMTP_SECURE must be true or false.');
  }

  const user = config.get<string>('SMTP_USER')?.trim();
  const pass = config.get<string>('SMTP_PASSWORD');
  if (Boolean(user) !== Boolean(pass)) {
    throw new Error('Set both SMTP_USER and SMTP_PASSWORD or neither.');
  }

  return new SmtpEmailProvider({
    host,
    from,
    port,
    secure: secure === 'true',
    ...(user && pass && { auth: { user, pass } }),
  });
}

function createLogEmailProvider(config: ConfigService): LogEmailProvider {
  if (config.get<string>('NODE_ENV') !== 'development') {
    throw new Error('MAIL_DRIVER=log requires NODE_ENV=development.');
  }
  return new LogEmailProvider();
}

export function selectEmailProvider(
  config: ConfigService,
): EmailProvider | null {
  switch (config.get<string>('MAIL_DRIVER')) {
    case undefined:
    case '':
      return null;
    case 'smtp':
      return createSmtpEmailProvider(config);
    case 'log':
      return createLogEmailProvider(config);
    default:
      throw new Error('Unsupported MAIL_DRIVER.');
  }
}

@Module({
  imports: [ConfigModule, JobsModule, TypeOrmModule.forFeature([TenantUser])],
  providers: [
    TenantUserRepository,
    EmailSendQuotaRepository,
    EmailService,
    EmailWorker,
    {
      provide: EmailProvider,
      inject: [ConfigService],
      useFactory: selectEmailProvider,
    },
  ],
  exports: [EmailService],
})
export class EmailModule {}
