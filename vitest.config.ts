import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/spec-compliance/**/*.test.ts'],
    environment: 'node',
    globals: true,
    setupFiles: ['./test/spec-compliance/setup.ts'],
  },
});
