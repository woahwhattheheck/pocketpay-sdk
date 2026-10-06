import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['polling-peer.test.ts'],
    pool: 'forks',
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,
    testTimeout: 2000,
  },
});
