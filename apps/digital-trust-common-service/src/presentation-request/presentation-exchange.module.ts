import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PresentationExchange } from './presentation-exchange.entity';
import { PresentationExchangeRepository } from './presentation-exchange.repository';

@Module({
  imports: [TypeOrmModule.forFeature([PresentationExchange])],
  providers: [PresentationExchangeRepository],
  exports: [PresentationExchangeRepository],
})
export class PresentationExchangeModule {}
