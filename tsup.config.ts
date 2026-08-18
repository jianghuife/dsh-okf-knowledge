import { defineConfig } from 'tsup'

/**
 * Runtime module table the DSH web loader can answer. Everything else must be
 * inlined into the client bundle. Mirrors PLATFORM_MODULES in
 * deepseek-harness packages/client/web/src/platform.ts.
 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
]

const CLIENT_ID = 'dsh-okf-knowledge'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    outDir: 'dist',
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    dts: true,
    clean: true,
    sourcemap: true,
  },
  {
    // Browser half: the DSH web loader expects a lazy-CJS factory closure
    // (window.__ModuleLoader__.load), not an ESM module. `require` resolves
    // through the loader module table, so platform modules stay external and
    // everything else is inlined.
    entry: { client: 'src/client/index.ts' },
    outDir: 'dist',
    format: 'cjs',
    outExtension: () => ({ js: '.js' }),
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    sourcemap: false,
    external: PLATFORM_MODULES,
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    banner: {
      js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(CLIENT_ID)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
    },
    footer: {
      js: 'return module.exports; } });',
    },
  },
])
