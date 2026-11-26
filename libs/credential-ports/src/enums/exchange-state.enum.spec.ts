import {
  ConnectionState,
  CredentialExchangeState,
  PresentationExchangeState,
} from './exchange-state.enum';

describe('CredentialExchangeState', () => {
  it('should expose stable credential exchange string values', () => {
    expect(CredentialExchangeState.ProposalSent).toBe('proposal-sent');
    expect(CredentialExchangeState.OfferSent).toBe('offer-sent');
    expect(CredentialExchangeState.OfferReceived).toBe('offer-received');
    expect(CredentialExchangeState.RequestSent).toBe('request-sent');
    expect(CredentialExchangeState.RequestReceived).toBe('request-received');
    expect(CredentialExchangeState.CredentialIssued).toBe('credential-issued');
    expect(CredentialExchangeState.CredentialReceived).toBe(
      'credential-received',
    );
    expect(CredentialExchangeState.Done).toBe('done');
    expect(CredentialExchangeState.Abandoned).toBe('abandoned');
  });
});

describe('PresentationExchangeState', () => {
  it('should expose stable presentation exchange string values', () => {
    expect(PresentationExchangeState.ProposalSent).toBe('proposal-sent');
    expect(PresentationExchangeState.ProposalReceived).toBe(
      'proposal-received',
    );
    expect(PresentationExchangeState.RequestSent).toBe('request-sent');
    expect(PresentationExchangeState.RequestReceived).toBe('request-received');
    expect(PresentationExchangeState.PresentationSent).toBe(
      'presentation-sent',
    );
    expect(PresentationExchangeState.PresentationReceived).toBe(
      'presentation-received',
    );
    expect(PresentationExchangeState.Verified).toBe('verified');
    expect(PresentationExchangeState.Abandoned).toBe('abandoned');
    expect(PresentationExchangeState.Done).toBe('done');
  });
});

describe('ConnectionState', () => {
  it('should expose stable connection string values', () => {
    expect(ConnectionState.Invitation).toBe('invitation');
    expect(ConnectionState.Request).toBe('request');
    expect(ConnectionState.Response).toBe('response');
    expect(ConnectionState.Active).toBe('active');
    expect(ConnectionState.Completed).toBe('completed');
    expect(ConnectionState.Error).toBe('error');
  });
});
