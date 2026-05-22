import { vi } from 'vitest';

// Stub dotenv in tests
vi.mock('dotenv', () => ({
  default: { config: vi.fn() },
}));
