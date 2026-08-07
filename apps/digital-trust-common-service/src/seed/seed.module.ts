import { DatabaseModule } from '@app/database';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EncryptionModule } from '../common/crypto/encryption.module';

import { DevSeedService } from './dev-seed.service';
import { SEED_ENTITIES, SEED_REPOSITORY_PROVIDERS } from './seed.constants';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    EncryptionModule,
    TypeOrmModule.forFeature([...SEED_ENTITIES]),
  ],
  providers: [DevSeedService, ...SEED_REPOSITORY_PROVIDERS],
  exports: [DevSeedService],
})
export class SeedModule {}
