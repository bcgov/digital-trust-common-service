import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { VerificationProfile } from './verification-profile.entity';
import { VerificationProfileRepository } from './verification-profile.repository';

@Module({
  imports: [TypeOrmModule.forFeature([VerificationProfile])],
  providers: [VerificationProfileRepository],
  exports: [VerificationProfileRepository],
})
export class VerificationProfileModule {}
