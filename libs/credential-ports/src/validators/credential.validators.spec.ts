import { OfferCredentialRequest } from '../dto/offer-credential-request.dto';
import { PresentationRequest } from '../dto/presentation-request.dto';
import { CredentialFormat } from '../enums/credential-format.enum';
import { ValidationError } from '../errors/adapter-error';

import {
  validateOfferCredentialRequest,
  validatePresentationRequest,
} from './credential.validators';

describe('validateOfferCredentialRequest', () => {
  const validRequest: OfferCredentialRequest = {
    claims: { given_name: 'Ada' },
    format: CredentialFormat.AnonCreds,
    schemaDefinition: {
      type: 'object',
      properties: { given_name: { type: 'string' } },
    },
  };

  it('should return null for valid input', () => {
    expect(validateOfferCredentialRequest(validRequest)).toBeNull();
  });

  it('should reject a missing format', () => {
    const request = {
      ...validRequest,
      format: undefined,
    } as unknown as OfferCredentialRequest;
    const result = validateOfferCredentialRequest(request);

    expect(result).toBeInstanceOf(ValidationError);
    expect(result?.issues).toContain('format is required/invalid');
  });

  it('should reject an invalid format', () => {
    const request = {
      ...validRequest,
      format: 'jwt-vc',
    } as unknown as OfferCredentialRequest;
    const result = validateOfferCredentialRequest(request);

    expect(result).toBeInstanceOf(ValidationError);
    expect(result?.issues).toContain('format is required/invalid');
  });

  it('should allow an empty claims object', () => {
    const request: OfferCredentialRequest = { ...validRequest, claims: {} };
    const result = validateOfferCredentialRequest(request);

    expect(result).toBeNull();
  });

  it('should reject missing claims', () => {
    const request = {
      ...validRequest,
      claims: undefined,
    } as unknown as OfferCredentialRequest;
    const result = validateOfferCredentialRequest(request);

    expect(result).toBeInstanceOf(ValidationError);
    expect(result?.issues).toContain('claims must be a non-null object');
  });

  it('should collect multiple offer validation issues', () => {
    const request = {
      format: 'jwt-vc',
      claims: undefined,
      schemaDefinition: undefined,
    } as unknown as OfferCredentialRequest;
    const result = validateOfferCredentialRequest(request);

    expect(result).toBeInstanceOf(ValidationError);
    expect(result?.issues).toEqual(
      expect.arrayContaining([
        'format is required/invalid',
        'claims must be a non-null object',
        'schemaDefinition must be a non-null object',
      ]),
    );
    expect(result?.issues).toHaveLength(3);
  });
});

describe('validatePresentationRequest', () => {
  const validRequest: PresentationRequest = {
    name: 'Proof of age',
    requestedAttributes: [{ name: 'given_name' }],
    requestedPredicates: [{ name: 'age', pType: '>=', pValue: 19 }],
  };

  it('should return null for valid input', () => {
    expect(validatePresentationRequest(validRequest)).toBeNull();
  });

  it('should reject an empty name', () => {
    const request: PresentationRequest = { ...validRequest, name: '' };
    const result = validatePresentationRequest(request);

    expect(result).toBeInstanceOf(ValidationError);
    expect(result?.issues).toContain('name must not be empty');
  });

  it('should reject empty requested attributes', () => {
    const request: PresentationRequest = {
      ...validRequest,
      requestedAttributes: [],
    };
    const result = validatePresentationRequest(request);

    expect(result).toBeInstanceOf(ValidationError);
    expect(result?.issues).toContain('requestedAttributes must not be empty');
  });

  it('should reject missing requested attributes', () => {
    const request = {
      ...validRequest,
      requestedAttributes: undefined,
    } as unknown as PresentationRequest;
    const result = validatePresentationRequest(request);

    expect(result).toBeInstanceOf(ValidationError);
    expect(result?.issues).toContain('requestedAttributes must not be empty');
  });

  it('should reject a requested attribute with an empty name', () => {
    const request: PresentationRequest = {
      ...validRequest,
      requestedAttributes: [{ name: '' }],
    };
    const result = validatePresentationRequest(request);

    expect(result).toBeInstanceOf(ValidationError);
    expect(result?.issues).toContain(
      'requestedAttribute name must not be empty',
    );
  });

  it('should allow omitted requested predicates', () => {
    const request: PresentationRequest = {
      name: 'Proof of name',
      requestedAttributes: [{ name: 'given_name' }],
    };

    expect(validatePresentationRequest(request)).toBeNull();
  });

  it('should reject non-array requested predicates when provided', () => {
    const request = {
      ...validRequest,
      requestedPredicates: 'not-an-array',
    } as unknown as PresentationRequest;
    const result = validatePresentationRequest(request);

    expect(result).toBeInstanceOf(ValidationError);
    expect(result?.issues).toContain('requestedPredicates must be an array');
  });
  it('should reject a requested predicate with an empty name', () => {
    const request: PresentationRequest = {
      ...validRequest,
      requestedPredicates: [{ name: '', pType: '>=', pValue: 19 }],
    };
    const result = validatePresentationRequest(request);

    expect(result).toBeInstanceOf(ValidationError);
    expect(result?.issues).toContain(
      'requestedPredicate name must not be empty',
    );
  });

  it('should reject a requested predicate with an empty pType', () => {
    const request: PresentationRequest = {
      ...validRequest,
      requestedPredicates: [{ name: 'age', pType: '', pValue: 19 }],
    };
    const result = validatePresentationRequest(request);

    expect(result).toBeInstanceOf(ValidationError);
    expect(result?.issues).toContain(
      'requestedPredicate pType must not be empty',
    );
  });

  it('should reject a requested predicate with a non-numeric pValue', () => {
    const request = {
      ...validRequest,
      requestedPredicates: [{ name: 'age', pType: '>=', pValue: '19' }],
    } as unknown as PresentationRequest;
    const result = validatePresentationRequest(request);

    expect(result).toBeInstanceOf(ValidationError);
    expect(result?.issues).toContain(
      'requestedPredicate pValue must be numeric',
    );
  });

  it('should collect multiple presentation validation issues', () => {
    const request = {
      name: '',
      requestedAttributes: [{ name: '' }],
      requestedPredicates: [{ name: '', pType: '', pValue: '19' }],
    } as unknown as PresentationRequest;
    const result = validatePresentationRequest(request);

    expect(result).toBeInstanceOf(ValidationError);
    expect(result?.issues).toEqual(
      expect.arrayContaining([
        'name must not be empty',
        'requestedAttribute name must not be empty',
        'requestedPredicate name must not be empty',
        'requestedPredicate pType must not be empty',
        'requestedPredicate pValue must be numeric',
      ]),
    );
    expect(result?.issues).toHaveLength(5);
  });
});
