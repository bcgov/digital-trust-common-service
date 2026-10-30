export function registrationErrorText(
  value: unknown,
  secrets: readonly string[] = [],
): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }
  let text = value;
  for (const secret of secrets) {
    if (secret) {
      text = text.split(secret).join('[REDACTED]');
    }
  }
  return text
    .replace(/\b(Bearer|Basic)\s+\S+/gi, '$1 [REDACTED]')
    .replace(
      /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      '[REDACTED]',
    )
    .replace(
      /((?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|wallet[_-]?secret|password|secret|token)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi,
      '$1[REDACTED]',
    )
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL REDACTED]')
    .split('')
    .map((character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
        ? ' '
        : character,
    )
    .join('')
    .slice(0, 1024);
}

/** Carries only sanitized registration diagnostics, never Axios configuration. */
export class RegistrationBackendError extends Error {
  public constructor(
    public readonly status: number | undefined,
    public readonly backendCode: string | undefined,
    public readonly detail: string,
    public readonly responseInvalid = false,
  ) {
    super(detail);
    this.name = RegistrationBackendError.name;
  }
}
