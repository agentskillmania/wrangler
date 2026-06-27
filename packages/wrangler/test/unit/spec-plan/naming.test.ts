import { describe, it, expect } from 'vitest';
import {
  formatSpecFileName,
  parseSpecFileName,
  formatPlanFileName,
  parsePlanFileName,
} from '../../../src/spec-plan/naming.js';

describe('spec file naming', () => {
  describe('formatSpecFileName', () => {
    it('formats spec file name with name and version', () => {
      const result = formatSpecFileName({
        name: 'user-login',
        version: 1,
      });
      expect(result).toBe('user-login-spec-v1.md');
    });

    it('formats with higher version number', () => {
      const result = formatSpecFileName({
        name: 'auth-system',
        version: 3,
      });
      expect(result).toBe('auth-system-spec-v3.md');
    });

    it('handles name with underscores', () => {
      const result = formatSpecFileName({
        name: 'my_feature',
        version: 1,
      });
      expect(result).toBe('my_feature-spec-v1.md');
    });

    it('handles name with hyphens', () => {
      const result = formatSpecFileName({
        name: 'user-auth-flow',
        version: 2,
      });
      expect(result).toBe('user-auth-flow-spec-v2.md');
    });
  });

  describe('parseSpecFileName', () => {
    it('parses valid spec file name', () => {
      const result = parseSpecFileName('user-login-spec-v1.md');
      expect(result).toEqual({
        name: 'user-login',
        version: 1,
      });
    });

    it('parses name with underscores', () => {
      const result = parseSpecFileName('my_feature-spec-v2.md');
      expect(result).toEqual({
        name: 'my_feature',
        version: 2,
      });
    });

    it('parses name with hyphens', () => {
      const result = parseSpecFileName('user-auth-flow-spec-v3.md');
      expect(result).toEqual({
        name: 'user-auth-flow',
        version: 3,
      });
    });

    // --- Negative paths ---

    it('returns null for invalid extension', () => {
      expect(parseSpecFileName('user-login-spec-v1.txt')).toBeNull();
    });

    it('returns null for missing spec marker', () => {
      expect(parseSpecFileName('user-login-v1.md')).toBeNull();
    });

    it('returns null for missing version', () => {
      expect(parseSpecFileName('user-login-spec.md')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseSpecFileName('')).toBeNull();
    });

    it('returns null for name with only version marker', () => {
      expect(parseSpecFileName('-spec-v1.md')).toBeNull();
    });

    it('returns null for non-numeric version', () => {
      expect(parseSpecFileName('test-spec-vabc.md')).toBeNull();
    });
  });

  describe('round-trip', () => {
    it('format then parse returns original values', () => {
      const params = { name: 'user-auth', version: 2 };
      const formatted = formatSpecFileName(params);
      const parsed = parseSpecFileName(formatted);
      expect(parsed).toEqual({
        name: params.name,
        version: params.version,
      });
    });

    it('round-trip with hyphens in name', () => {
      const params = { name: 'my-feature-v2', version: 1 };
      const formatted = formatSpecFileName(params);
      const parsed = parseSpecFileName(formatted);
      expect(parsed).toEqual({
        name: params.name,
        version: params.version,
      });
    });
  });
});

describe('plan file naming', () => {
  describe('formatPlanFileName', () => {
    it('formats plan file name with name, spec version, and plan version', () => {
      const result = formatPlanFileName({
        name: 'user-login',
        specVersion: 1,
        version: 1,
      });
      expect(result).toBe('user-login-v1-plan-v1.md');
    });

    it('formats with different spec and plan versions', () => {
      const result = formatPlanFileName({
        name: 'auth-system',
        specVersion: 2,
        version: 3,
      });
      expect(result).toBe('auth-system-v2-plan-v3.md');
    });

    it('handles name with hyphens', () => {
      const result = formatPlanFileName({
        name: 'user-auth-flow',
        specVersion: 1,
        version: 2,
      });
      expect(result).toBe('user-auth-flow-v1-plan-v2.md');
    });
  });

  describe('parsePlanFileName', () => {
    it('parses valid plan file name', () => {
      const result = parsePlanFileName('user-login-v1-plan-v1.md');
      expect(result).toEqual({
        name: 'user-login',
        specVersion: 1,
        version: 1,
      });
    });

    it('parses with different versions', () => {
      const result = parsePlanFileName('auth-v2-plan-v3.md');
      expect(result).toEqual({
        name: 'auth',
        specVersion: 2,
        version: 3,
      });
    });

    it('parses name with hyphens', () => {
      const result = parsePlanFileName('my-feature-v2-v1-plan-v2.md');
      expect(result).toEqual({
        name: 'my-feature-v2',
        specVersion: 1,
        version: 2,
      });
    });

    // --- Negative paths ---

    it('returns null for invalid extension', () => {
      expect(parsePlanFileName('user-login-v1-plan-v1.txt')).toBeNull();
    });

    it('returns null for missing plan marker', () => {
      expect(parsePlanFileName('user-login-v1.md')).toBeNull();
    });

    it('returns null for missing spec version', () => {
      expect(parsePlanFileName('user-login-plan-v1.md')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parsePlanFileName('')).toBeNull();
    });

    it('returns null for missing plan version', () => {
      expect(parsePlanFileName('user-login-v1-plan.md')).toBeNull();
    });
  });

  describe('round-trip', () => {
    it('format then parse returns original values', () => {
      const params = {
        name: 'user-auth',
        specVersion: 1,
        version: 2,
      };
      const formatted = formatPlanFileName(params);
      const parsed = parsePlanFileName(formatted);
      expect(parsed).toEqual({
        name: params.name,
        specVersion: params.specVersion,
        version: params.version,
      });
    });

    it('round-trip with hyphens in name', () => {
      const params = { name: 'my-plan-v2', specVersion: 3, version: 1 };
      const formatted = formatPlanFileName(params);
      const parsed = parsePlanFileName(formatted);
      expect(parsed).toEqual({
        name: params.name,
        specVersion: params.specVersion,
        version: params.version,
      });
    });
  });
});
