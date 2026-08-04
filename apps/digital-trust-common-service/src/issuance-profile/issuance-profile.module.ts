import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { IssuanceProfile } from './issuance-profile.entity';
import { IssuanceProfileRepository } from './issuance-profile.repository';

@Module({
  imports: [TypeOrmModule.forFeature([IssuanceProfile])],
  providers: [IssuanceProfileRepository],
  exports: [IssuanceProfileRepository],
})
export class IssuanceProfileModule {}
