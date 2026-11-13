import { OfferCredentialRequest } from '../dto/offer-credential-request.dto';
import { PresentationRequest } from '../dto/presentation-request.dto';
import { CredentialFormat } from '../enums/credential-format.enum';
import { ValidationError } from '../errors/adapter-error';

const credentialFormats: readonly CredentialFormat[] =
  Object.values(CredentialFormat);

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isReadonlyArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Returns null if valid, otherwise a ValidationError listing all problems.
export function validateOfferCredentialRequest(
  req: OfferCredentialRequest,
): ValidationError | null {
  if (!isRecord(req)) {
    return new ValidationError(['request must be a non-null object']);
  }

  const issues: string[] = [];

  if (!credentialFormats.includes(req.format)) {
    issues.push('format is required/invalid');
  }

  if (!isRecord(req.claims)) {
    issues.push('claims must be a non-null object');
  }
  if (!isRecord(req.schemaDefinition)) {
    issues.push('schemaDefinition must be a non-null object');
  }

  return issues.length === 0 ? null : new ValidationError(issues);
}

// Returns null if valid, otherwise a ValidationError listing all problems.
export function validatePresentationRequest(
  req: PresentationRequest,
): ValidationError | null {
  if (!isRecord(req)) {
    return new ValidationError(['request must be a non-null object']);
  }

  const issues: string[] = [];

  if (!hasText(req.name)) {
    issues.push('name must not be empty');
  }

  const requestedAttributes: unknown = req.requestedAttributes;

  if (
    !isReadonlyArray(requestedAttributes) ||
    requestedAttributes.length === 0
  ) {
    issues.push('requestedAttributes must not be empty');
  } else {
    requestedAttributes.forEach((attribute) => {
      if (!isRecord(attribute) || !hasText(attribute.name)) {
        issues.push('requestedAttribute name must not be empty');
      }
    });
  }

  const requestedPredicates: unknown = req.requestedPredicates;

  if (requestedPredicates !== undefined) {
    if (!isReadonlyArray(requestedPredicates)) {
      issues.push('requestedPredicates must be an array');
    } else {
      requestedPredicates.forEach((predicate) => {
        if (!isRecord(predicate) || !hasText(predicate.name)) {
          issues.push('requestedPredicate name must not be empty');
        }

        if (!isRecord(predicate) || !hasText(predicate.pType)) {
          issues.push('requestedPredicate pType must not be empty');
        }

        if (
          !isRecord(predicate) ||
          typeof predicate.pValue !== 'number' ||
          Number.isNaN(predicate.pValue)
        ) {
          issues.push('requestedPredicate pValue must be numeric');
        }
      });
    }
  }

  return issues.length === 0 ? null : new ValidationError(issues);
}
