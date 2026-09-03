import { FormatValidator } from './format-validator.port';

describe('FormatValidator', () => {
  it('is usable as a DI token for the format-validator strategy contract', () => {
    expect(FormatValidator).toBeDefined();
    expect(FormatValidator.name).toBe('FormatValidator');
  });
});
