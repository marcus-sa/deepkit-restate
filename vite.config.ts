import { deepkitType } from '@deepkit/vite';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig(({ mode }) => {
  return {
    build: {
      outDir: 'lib',
      rollupOptions: {
        preserveEntrySignatures: 'strict',
        output: {
          esModule: true,
        },
      },
      lib: {
        entry: 'src/index.ts',
        formats: ['es', 'cjs'],
      },
    },
    ssr: {
      external: true,
    },
    resolve: {
      mainFields: ['module'],
    },
    plugins: [
      deepkitType({
        compilerOptions: {
          sourceMap: true,
        },
      }),
      dts({ rollupTypes: true }),
    ],
    test: {
      globals: true,
      passWithNoTests: true,
      environment: 'node',
      include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
      reporters: ['default'],
      testTimeout: Infinity,
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
