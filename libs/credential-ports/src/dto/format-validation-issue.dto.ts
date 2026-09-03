// Structured description of a single format-validation failure.
export interface FormatValidationIssue {
  // Attribute or schema field the issue relates to.
  readonly field: string;
  // What the validator expected to find.
  readonly expected: string;
  // What was actually found.
  readonly actual: string;
  // Human-readable explanation of the failure.
  readonly message: string;
}
