import { FormatValidationIssue } from '../dto/format-validation-issue.dto';

// Base class for stable, machine-readable adapter errors.
export abstract class AdapterError extends Error {
  // Stable machine-readable code.
  public abstract readonly code: string;

  // Optional structured context for the error.
  public readonly context?: Readonly<Record<string, unknown>>;

  protected constructor(
    message: string,
    context?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = new.target.name;
    this.context = context;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// Error thrown when the selected connector is unavailable.
export class ConnectorUnavailableError extends AdapterError {
  // Stable machine-readable code.
  public readonly code = 'CONNECTOR_UNAVAILABLE';

  public constructor(
    message = 'Connector is unavailable',
    context?: Readonly<Record<string, unknown>>,
  ) {
    super(message, context);
  }
}

// Error thrown when a credential format is not supported.
export class FormatNotSupportedError extends AdapterError {
  // Stable machine-readable code.
  public readonly code = 'FORMAT_NOT_SUPPORTED';

  public constructor(
    format: string,
    context?: Readonly<Record<string, unknown>>,
  ) {
    super(`Credential format not supported: ${format}`, { ...context, format });
  }
}

// Error thrown when an adapter operation times out.
export class TimeoutError extends AdapterError {
  // Stable machine-readable code.
  public readonly code = 'TIMEOUT';

  public constructor(
    message = 'Operation timed out',
    context?: Readonly<Record<string, unknown>>,
  ) {
    super(message, context);
  }
}

// Error returned when request validation fails.
export class ValidationError extends AdapterError {
  // Stable machine-readable code.
  public readonly code = 'VALIDATION_ERROR';

  // All validation issues found in the request.
  public readonly issues: readonly string[];

  public constructor(issues: readonly string[], message = 'Validation failed') {
    super(message, { issues });
    this.issues = issues;
  }
}

// Error returned when format-specific schema or attribute validation
// fails. Distinct from ValidationError: issues here are structured per field
// rather than free-text, so callers can surface them per-attribute.
export class FormatValidationError extends AdapterError {
  // Stable machine-readable code.
  public readonly code = 'FORMAT_VALIDATION_ERROR';

  // All validation issues found, one per offending field.
  public readonly issues: readonly FormatValidationIssue[];

  public constructor(
    issues: readonly FormatValidationIssue[],
    message = 'Format validation failed',
  ) {
    super(message, { issues });
    this.issues = issues;
  }
}
