// Lets node:test import the runtime pack's TypeScript as written for a
// bundler. Import this before any of it, then import the modules dynamically
// (a static import is linked before this file runs):
//   - an extensionless relative specifier ('./config') resolves to .ts or .tsx;
//   - .tsx is compiled with the esbuild Vite ships, since Node's type stripping
//     does not cover JSX. Plain .ts goes through Node's own type stripping.

import { existsSync, readFileSync } from 'node:fs'
import { createRequire, registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { transformSync } = createRequire(require.resolve('vite'))('esbuild')

registerHooks({
  resolve(specifier, context, nextResolve) {
    const fromTs = /\.tsx?$/.test(context.parentURL ?? '')
    if (fromTs && /^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      for (const ext of ['.ts', '.tsx']) {
        const url = new URL(specifier + ext, context.parentURL)
        if (existsSync(url)) return nextResolve(url.href, context)
      }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx')) return nextLoad(url, context)
    const { code } = transformSync(readFileSync(new URL(url), 'utf8'), {
      loader: 'tsx',
      jsx: 'automatic',
      format: 'esm',
      sourcefile: fileURLToPath(url)
    })
    return { format: 'module', source: code, shortCircuit: true }
  }
})
