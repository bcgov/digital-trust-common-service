import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdapterRegistryModule } from '../adapter-registry/adapter-registry.module';
import { ConnectionModule } from '../connection/connection.module';
import { OperationModule } from '../operation/operation.module';

import { PresentationExchangeLifecycleService } from './presentation-exchange-lifecycle.service';
import { PresentationExchange } from './presentation-exchange.entity';
import { PresentationExchangeRepository } from './presentation-exchange.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([PresentationExchange]),
    AdapterRegistryModule,
    ConnectionModule,
    OperationModule,
  ],
  providers: [
    PresentationExchangeRepository,
    PresentationExchangeLifecycleService,
  ],
  exports: [
    PresentationExchangeRepository,
    PresentationExchangeLifecycleService,
  ],
})
export class PresentationExchangeModule {}
