import { defineConfig, mergeConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import original from './vitest.config.mts';

export default mergeConfig(original, defineConfig({
  test: {
    setupFiles: [fileURLToPath(new URL('./validation-network-setup.ts', import.meta.url))],
  },
}));
