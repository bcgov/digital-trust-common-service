import { NotImplementedException } from '@nestjs/common';

import { ConnectorType } from '../enums/connector-type.enum';
import { CredentialFormat } from '../enums/credential-format.enum';

import { StubAdapter } from './stub-adapter';

describe('StubAdapter', () => {
  let stub: StubAdapter;

  beforeEach(() => {
    stub = new StubAdapter();
  });

  it('should declare a connector type', () => {
    expect(Object.values(ConnectorType)).toContain(stub.connectorType);
  });

  it('should declare at least one supported format', () => {
    expect(stub.supportedFormats.length).toBeGreaterThan(0);
    stub.supportedFormats.forEach((format) => {
      expect(Object.values(CredentialFormat)).toContain(format);
    });
  });

  it('should reject offerCredential', async () => {
    await expect(
      stub.offerCredential({
        attributes: [{ name: 'given_name', value: 'Avery' }],
        format: CredentialFormat.AnonCreds,
      }),
    ).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('should reject getExchange', async () => {
    await expect(stub.getExchange('exchange-id')).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });

  it('should reject requestPresentation', async () => {
    await expect(
      stub.requestPresentation({
        name: 'Proof request',
        requestedAttributes: [{ name: 'given_name' }],
      }),
    ).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('should reject getPresentation', async () => {
    await expect(
      stub.getPresentation('presentation-id'),
    ).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('should reject acceptOffer', async () => {
    await expect(stub.acceptOffer('exchange-id')).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });

  it('should reject rejectOffer', async () => {
    await expect(stub.rejectOffer('exchange-id')).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });

  it('should reject createInvitation', async () => {
    await expect(stub.createInvitation({})).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });

  it('should reject acceptInvitation', async () => {
    await expect(
      stub.acceptInvitation('https://example.com/invitation'),
    ).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('should reject list', async () => {
    await expect(stub.list({})).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('should reject getById', async () => {
    await expect(stub.getById('connection-id')).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });

  it('should reject revoke', async () => {
    await expect(stub.revoke('credential-id')).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });

  it('should reject batchRevoke', async () => {
    await expect(stub.batchRevoke(['credential-id'])).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });
});
