import { deepkitType } from '@deepkit/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  return {
    resolve: {
      mainFields: ['module'],
    },
    plugins: [
      deepkitType({
        compilerOptions: {
          sourceMap: true,
        },
      }),
    ],
    test: {
      globals: true,
      passWithNoTests: true,
      environment: 'node',
      include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
      reporters: ['default'],
      testTimeout: 60_000,
      coverage: {
        provider: 'v8',
      },
      cache: {
        dir: 'node_modules/.cache/vitest',
      },
    },
    define: {
      'import.meta.vitest': mode === 'test',
    },
  };
});
