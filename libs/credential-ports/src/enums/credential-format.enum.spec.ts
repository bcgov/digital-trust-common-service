import { CredentialFormat } from './credential-format.enum';

describe('CredentialFormat', () => {
  it('should expose stable credential format string values', () => {
    expect(CredentialFormat.AnonCreds).toBe('anoncreds');
    expect(CredentialFormat.JsonLd).toBe('jsonld');
    expect(CredentialFormat.SdJwtVc).toBe('sd-jwt-vc');
    expect(CredentialFormat.Mdl).toBe('mdl');
  });
});
