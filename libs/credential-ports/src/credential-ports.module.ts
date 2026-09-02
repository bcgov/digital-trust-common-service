import { Module, OnModuleInit } from '@nestjs/common';

import { ConnectionPort } from './ports/connection.port';
import { HolderPort } from './ports/holder.port';
import { IssuerPort } from './ports/issuer.port';
import { RevocationPort } from './ports/revocation.port';
import { VerifierPort } from './ports/verifier.port';
import { StubAdapter } from './testing/stub-adapter';
import { AnonCredsFormatValidator } from './validators/anoncreds-format.validator';
import { FormatValidatorRegistry } from './validators/format-validator.registry';

/**
 * Provides fail-closed default bindings for all credential port contracts,
 * plus the FormatValidatorRegistry, pre-populated with every
 * FormatValidator this library ships.
 */
@Module({
  providers: [
    StubAdapter,
    { provide: IssuerPort, useExisting: StubAdapter },
    { provide: VerifierPort, useExisting: StubAdapter },
    { provide: HolderPort, useExisting: StubAdapter },
    { provide: ConnectionPort, useExisting: StubAdapter },
    { provide: RevocationPort, useExisting: StubAdapter },
    FormatValidatorRegistry,
    AnonCredsFormatValidator,
  ],
  exports: [
    IssuerPort,
    VerifierPort,
    HolderPort,
    ConnectionPort,
    RevocationPort,
    FormatValidatorRegistry,
  ],
})
export class CredentialPortsModule implements OnModuleInit {
  public constructor(
    private readonly formatValidatorRegistry: FormatValidatorRegistry,
    private readonly anonCredsFormatValidator: AnonCredsFormatValidator,
  ) {}

  public onModuleInit(): void {
    this.formatValidatorRegistry.register(this.anonCredsFormatValidator);
  }
}
