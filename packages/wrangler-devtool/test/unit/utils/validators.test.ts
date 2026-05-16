import { describe, it, expect } from 'vitest';
import { isValidName, validateName } from '../../../src/utils/validators.js';

describe('isValidName', () => {
  it('should accept valid names', () => {
    expect(isValidName('agent-1')).toBe(true);
    expect(isValidName('my_agent')).toBe(true);
    expect(isValidName('TestName')).toBe(true);
    expect(isValidName('a')).toBe(true);
  });

  it('should reject empty names', () => {
    expect(isValidName('')).toBe(false);
  });

  it('should reject names with spaces', () => {
    expect(isValidName('my agent')).toBe(false);
  });

  it('should reject names with special chars', () => {
    expect(isValidName('agent@')).toBe(false);
    expect(isValidName('agent!')).toBe(false);
  });

  it('should reject names over 64 chars', () => {
    expect(isValidName('a'.repeat(65))).toBe(false);
  });
});

describe('validateName', () => {
  it('should not throw for valid names', () => {
    expect(() => validateName('valid')).not.toThrow();
  });

  it('should throw for invalid names', () => {
    expect(() => validateName('')).toThrow();
    expect(() => validateName('bad name')).toThrow();
  });
});
