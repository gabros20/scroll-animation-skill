// ui.mjs — output and errors: colours, CliError/fail, pretty JSON.

export const c = {
  red: (s) => (process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s) => (process.stdout.isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  green: (s) => (process.stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  dim: (s) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s)
}

/** A message for the user and an exit code (0 ok / 1 problems / 2 usage — never anything else).
 * Thrown, never exited on the spot: only run() (index.mjs) turns it into process.exitCode, so a
 * command can be called from a test harness without killing the process. */
export class CliError extends Error {
  constructor(message, code = 1) {
    super(message)
    this.code = code
  }
}

export function fail(message, code = 1) {
  throw new CliError(message, code)
}

/** JSON with small objects and arrays kept on one line — used by `list --json` and friends. */
export function prettyJson(value, indent = '') {
  const inner = indent + '  '
  if (Array.isArray(value)) {
    const flat = JSON.stringify(value)
    return flat.length <= 72 ? flat.replace(/,/g, ', ') : `[\n${value.map((v) => inner + prettyJson(v, inner)).join(',\n')}\n${indent}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
    if (!entries.length) return '{}'
    const flat = `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v).replace(/,/g, ', ').replace(/:/g, ': ')}`).join(', ')} }`
    if (flat.length <= 72 && entries.every(([, v]) => typeof v !== 'object' || v === null || JSON.stringify(v).length < 40)) return flat
    return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${prettyJson(v, inner)}`).join(',\n')}\n${indent}}`
  }
  return JSON.stringify(value)
}
