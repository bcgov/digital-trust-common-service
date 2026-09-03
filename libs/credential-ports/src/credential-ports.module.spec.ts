import { NotImplementedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { CredentialPortsModule } from './credential-ports.module';
import { CredentialFormat } from './enums/credential-format.enum';
import { ConnectionPort } from './ports/connection.port';
import { HolderPort } from './ports/holder.port';
import { IssuerPort } from './ports/issuer.port';
import { RevocationPort } from './ports/revocation.port';
import { VerifierPort } from './ports/verifier.port';
import { StubAdapter } from './testing/stub-adapter';
import { FormatValidatorRegistry } from './validators/format-validator.registry';

describe('CredentialPortsModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [CredentialPortsModule],
    }).compile();

    // Triggers onModuleInit, which registers this module's format validators.
    await module.init();
  });

  it('should provide IssuerPort as StubAdapter', () => {
    const port = module.get<IssuerPort>(IssuerPort);

    expect(port).toBeDefined();
    expect(port).toBeInstanceOf(StubAdapter);
  });

  it('should provide VerifierPort as StubAdapter', () => {
    const port = module.get<VerifierPort>(VerifierPort);

    expect(port).toBeDefined();
    expect(port).toBeInstanceOf(StubAdapter);
  });

  it('should provide HolderPort as StubAdapter', () => {
    const port = module.get<HolderPort>(HolderPort);

    expect(port).toBeDefined();
    expect(port).toBeInstanceOf(StubAdapter);
  });

  it('should provide ConnectionPort as StubAdapter', () => {
    const port = module.get<ConnectionPort>(ConnectionPort);

    expect(port).toBeDefined();
    expect(port).toBeInstanceOf(StubAdapter);
  });

  it('should provide RevocationPort as StubAdapter', () => {
    const port = module.get<RevocationPort>(RevocationPort);

    expect(port).toBeDefined();
    expect(port).toBeInstanceOf(StubAdapter);
  });

  it('should fail closed through provided ports', async () => {
    const port = module.get<IssuerPort>(IssuerPort);

    await expect(
      port.offerCredential({
        attributes: [{ name: 'given_name', value: 'Avery' }],
        format: CredentialFormat.AnonCreds,
      }),
    ).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('registers the AnonCreds format validator on the shared registry', () => {
    const registry = module.get<FormatValidatorRegistry>(
      FormatValidatorRegistry,
    );

    expect(registry.has(CredentialFormat.AnonCreds)).toBe(true);
  });
});
