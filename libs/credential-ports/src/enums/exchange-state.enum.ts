// Credential issuance exchange lifecycle states.
export enum CredentialExchangeState {
  ProposalSent = 'proposal-sent',
  OfferSent = 'offer-sent',
  OfferReceived = 'offer-received',
  RequestSent = 'request-sent',
  RequestReceived = 'request-received',
  CredentialIssued = 'credential-issued',
  CredentialReceived = 'credential-received',
  Done = 'done',
  Abandoned = 'abandoned',
}

// Presentation proof exchange lifecycle states.
export enum PresentationExchangeState {
  ProposalSent = 'proposal-sent',
  ProposalReceived = 'proposal-received',
  RequestSent = 'request-sent',
  RequestReceived = 'request-received',
  PresentationSent = 'presentation-sent',
  PresentationReceived = 'presentation-received',
  Verified = 'verified',
  Abandoned = 'abandoned',
  Done = 'done',
}

// DIDComm connection lifecycle states.
export enum ConnectionState {
  Invitation = 'invitation',
  Request = 'request',
  Response = 'response',
  Active = 'active',
  Completed = 'completed',
  Error = 'error',
}
