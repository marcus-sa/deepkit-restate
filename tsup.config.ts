import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/kafka/index.ts'],
  outDir: 'lib',
  splitting: true,
  format: ['cjs', 'esm'],
  clean: true,
  dts: true,
});