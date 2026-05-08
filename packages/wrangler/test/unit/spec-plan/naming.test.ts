import { describe, it, expect } from 'vitest';
import {
  formatSpecFileName,
  parseSpecFileName,
  formatPlanFileName,
  parsePlanFileName,
} from '../../../src/spec-plan/naming.js';

describe('spec file naming', () => {
  describe('formatSpecFileName', () => {
    it('formats spec file name with timestamp, name, and version', () => {
      const result = formatSpecFileName({
        name: 'user-login',
        version: 1,
        timestamp: '20260423-143000',
      });
      expect(result).toBe('20260423-143000-user-login-spec-v1.md');
    });

    it('formats with higher version number', () => {
      const result = formatSpecFileName({
        name: 'auth-system',
        version: 3,
        timestamp: '20260501-090000',
      });
      expect(result).toBe('20260501-090000-auth-system-spec-v3.md');
    });

    it('handles name with underscores', () => {
      const result = formatSpecFileName({
        name: 'my_feature',
        version: 1,
        timestamp: '20260423-143000',
      });
      expect(result).toBe('20260423-143000-my_feature-spec-v1.md');
    });
  });

  describe('parseSpecFileName', () => {
    it('parses valid spec file name', () => {
      const result = parseSpecFileName('20260423-143000-user-login-spec-v1.md');
      expect(result).toEqual({
        timestamp: '20260423-143000',
        name: 'user-login',
        version: 1,
      });
    });

    it('parses name with underscores', () => {
      const result = parseSpecFileName('20260423-143000-my_feature-spec-v2.md');
      expect(result).toEqual({
        timestamp: '20260423-143000',
        name: 'my_feature',
        version: 2,
      });
    });

    it('returns null for invalid extension', () => {
      expect(parseSpecFileName('20260423-143000-test-spec-v1.txt')).toBeNull();
    });

    it('returns null for missing spec marker', () => {
      expect(parseSpecFileName('20260423-143000-test-v1.md')).toBeNull();
    });

    it('returns null for missing version', () => {
      expect(parseSpecFileName('20260423-143000-test-spec.md')).toBeNull();
    });

    it('returns null for missing timestamp', () => {
      expect(parseSpecFileName('test-spec-v1.md')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseSpecFileName('')).toBeNull();
    });
  });

  describe('round-trip', () => {
    it('format then parse returns original values', () => {
      const params = { name: 'user-auth', version: 2, timestamp: '20260423-143000' };
      const formatted = formatSpecFileName(params);
      const parsed = parseSpecFileName(formatted);
      expect(parsed).toEqual({
        timestamp: params.timestamp,
        name: params.name,
        version: params.version,
      });
    });
  });
});

describe('plan file naming', () => {
  describe('formatPlanFileName', () => {
    it('formats plan file name with timestamp, name, spec version, and plan version', () => {
      const result = formatPlanFileName({
        name: 'user-login',
        specVersion: 1,
        version: 1,
        timestamp: '20260423-150000',
      });
      expect(result).toBe('20260423-150000-user-login-v1-plan-v1.md');
    });

    it('formats with different spec and plan versions', () => {
      const result = formatPlanFileName({
        name: 'auth-system',
        specVersion: 2,
        version: 3,
        timestamp: '20260501-090000',
      });
      expect(result).toBe('20260501-090000-auth-system-v2-plan-v3.md');
    });
  });

  describe('parsePlanFileName', () => {
    it('parses valid plan file name', () => {
      const result = parsePlanFileName('20260423-150000-user-login-v1-plan-v1.md');
      expect(result).toEqual({
        timestamp: '20260423-150000',
        name: 'user-login',
        specVersion: 1,
        version: 1,
      });
    });

    it('parses with different versions', () => {
      const result = parsePlanFileName('20260501-090000-auth-v2-plan-v3.md');
      expect(result).toEqual({
        timestamp: '20260501-090000',
        name: 'auth',
        specVersion: 2,
        version: 3,
      });
    });

    it('returns null for invalid extension', () => {
      expect(parsePlanFileName('20260423-150000-test-v1-plan-v1.txt')).toBeNull();
    });

    it('returns null for missing plan marker', () => {
      expect(parsePlanFileName('20260423-150000-test-v1.md')).toBeNull();
    });

    it('returns null for missing spec version', () => {
      expect(parsePlanFileName('20260423-150000-test-plan-v1.md')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parsePlanFileName('')).toBeNull();
    });
  });

  describe('round-trip', () => {
    it('format then parse returns original values', () => {
      const params = {
        name: 'user-auth',
        specVersion: 1,
        version: 2,
        timestamp: '20260423-150000',
      };
      const formatted = formatPlanFileName(params);
      const parsed = parsePlanFileName(formatted);
      expect(parsed).toEqual({
        timestamp: params.timestamp,
        name: params.name,
        specVersion: params.specVersion,
        version: params.version,
      });
    });
  });
});
