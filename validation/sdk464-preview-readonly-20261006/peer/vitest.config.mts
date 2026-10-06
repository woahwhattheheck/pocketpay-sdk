import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: process.env.SDK464_INCLUDE_OWNER === '1'
      ? ['contract.test.ts', 'observations.test.ts', 'head-dfb/tests/vault-preview.test.ts']
      : ['contract.test.ts'],
    setupFiles: ['./network-setup.ts'],
    pool: 'forks', maxWorkers: 1, minWorkers: 1, fileParallelism: false,
    testTimeout: 3000,
  },
});
