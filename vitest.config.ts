import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      reporter: ['text-summary', 'lcov'],
      include: ['src/**', 'app/src/**'],
    },
  },
});
