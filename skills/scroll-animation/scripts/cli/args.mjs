// args.mjs — argument parsing and validation: flags and positionals, numeric flags.

import { fail } from './ui.mjs'

/** --flag value, --flag=value, --flag (true). A repeated flag collects an array. Everything
 * before the first bare "--" (if any) is parsed as flags/positionals as usual; "--" itself and
 * anything after it are dropped from `_` up front by callers that care (none here do yet). */
export function parse(argv) {
  const out = { _: [], flags: {} }
  const put = (k, v) => {
    if (out.flags[k] !== undefined) out.flags[k] = [].concat(out.flags[k], v)
    else out.flags[k] = v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=')
      if (eq > 2) {
        put(a.slice(2, eq), a.slice(eq + 1))
        continue
      }
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        put(key, next)
        i++
      } else put(key, true)
    } else out._.push(a)
  }
  return out
}

/** A required numeric flag value, validated. `def` is returned when the flag is absent; passing
 * the flag with no value (bare `--crf`) is always a usage error, not "use the default". */
export function numFlag(flags, name, { def, min, max, integer = false } = {}) {
  if (flags[name] === undefined) return def
  if (flags[name] === true) fail(`--${name} wants a number`, 2)
  const n = Number(flags[name])
  if (!Number.isFinite(n)) fail(`--${name}: ${JSON.stringify(flags[name])} is not a number`, 2)
  if (integer && !Number.isInteger(n)) fail(`--${name}: ${JSON.stringify(flags[name])} must be a whole number`, 2)
  if (min !== undefined && n < min) fail(`--${name}: ${n} is below ${min}`, 2)
  if (max !== undefined && n > max) fail(`--${name}: ${n} is above ${max}`, 2)
  return n
}

export const wantsHelp = (args) => {
  const end = args.indexOf('--')
  return (end === -1 ? args : args.slice(0, end)).some((a) => a === '--help' || a === '-h')
}
