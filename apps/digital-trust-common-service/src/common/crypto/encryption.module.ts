import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { EncryptionService } from './encryption.service';
import { KeyProviderService } from './key-provider.service';

@Module({
  imports: [ConfigModule],
  providers: [KeyProviderService, EncryptionService],
  exports: [EncryptionService],
})
export class EncryptionModule {}
