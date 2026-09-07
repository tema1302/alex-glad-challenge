import { fileURLToPath } from 'node:url';
import { transformWithEsbuild, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// tsconfig web ставит jsx: preserve (требование Next). Вне Next-пайплайна это
// ломает трансформ JSX в Vite — поэтому весь тестовый граф (тесты + app/components)
// прогоняем через esbuild с automatic runtime принудительно, до остального пайплайна.
const jsxAutomatic: Plugin = {
  name: 'jsx-automatic-for-tests',
  enforce: 'pre',
  async transform(code, id) {
    if (!/\.[jt]sx$/.test(id.split('?')[0])) return null;
    const out = await transformWithEsbuild(code, id, { jsx: 'automatic', loader: 'tsx' });
    return { code: out.code, map: out.map ?? null };
  },
};

// challenge/core написан в ESM-согенции TS: импорты с расширением '.js', файлы '.ts'.
// Vite сам такие импорты не резолвит — мапим '.js' → '.ts' для .ts-импортеров.
const tsJsExtension: Plugin = {
  name: 'ts-js-extension-map',
  async resolveId(source, importer, options) {
    if (source.endsWith('.js') && importer && /\.tsx?$/.test(importer)) {
      return this.resolve(`${source.slice(0, -3)}.ts`, importer, options);
    }
    return null;
  },
};

export default defineConfig({
  plugins: [jsxAutomatic, tsJsExtension],
  resolve: {
    alias: {
      // 'server-only' бросает вне RSC-рендера; в тестах — пустышка (см. stubs).
      'server-only': fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)),
      '@challenge': fileURLToPath(new URL('../challenge/src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.spec.{ts,tsx}'],
    testTimeout: 20_000,
  },
});
