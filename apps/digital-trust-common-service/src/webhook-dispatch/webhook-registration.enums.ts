export enum WebhookEvent {
  CREDENTIAL_ISSUED = 'credential.issued',
  CREDENTIAL_VERIFIED = 'credential.verified',
  CREDENTIAL_ACCEPTED = 'credential.accepted',
  CREDENTIAL_REJECTED = 'credential.rejected',
  CREDENTIAL_REVOKED = 'credential.revoked',
  CONNECTION_ESTABLISHED = 'connection.established',
}

export enum WebhookRegistrationStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}
