// eslint-no-fixed-wait.mjs: the lint rule behind the suites' ban on fixed waits (`npm run test:lint`).
//
// A fixed wait guesses how long something takes; on a loaded CI runner the guess is wrong now and then, and the
// check flakes. tests/lib/harness.mjs waits on conditions instead (settle, until, scrollToProgress, frames). This rule
// reports, in the browser suites:
//   - page.waitForTimeout(ms)
//   - a call to hold(), sleep() or wait(): the harness's fixed wait and the suites' old local helpers
//   - a sleep built by hand: setTimeout handing a Promise executor's resolve to the timer, with a delay other than a
//     literal 0 (a 0 delay yields one macrotask, which is a condition, not a guess)
// The allowlist is a comment: `fixed-wait: <reason>` (at least two words) on the call's line or the line above, for a
// wait that is about time itself (an observation window that must see nothing happen, a browser's own timer the
// page cannot observe, input paced like a hand).

const NAMES = new Set(['hold', 'sleep', 'wait'])
const ALLOW = /fixed-wait:\s*\S+\s+\S+/

/** The Promise executor's first parameter, when `node` sits inside `new Promise((resolve) => …)`. */
function executorResolve(node) {
  for (let p = node.parent; p; p = p.parent) {
    if ((p.type === 'ArrowFunctionExpression' || p.type === 'FunctionExpression') && p.parent?.type === 'NewExpression') {
      const ctor = p.parent
      if (ctor.callee.type === 'Identifier' && ctor.callee.name === 'Promise' && ctor.arguments[0] === p) {
        return p.params[0]?.type === 'Identifier' ? p.params[0].name : null
      }
    }
  }
  return null
}

/** setTimeout(resolve, ms) or setTimeout(() => resolve(…), ms) with that executor's resolve. */
function isHandRolledSleep(node) {
  const callee = node.callee
  const name = callee.type === 'Identifier' ? callee.name : callee.type === 'MemberExpression' ? callee.property.name : null
  if (name !== 'setTimeout') return false
  const [callback, delay] = node.arguments
  if (!delay || (delay.type === 'Literal' && delay.value === 0)) return false
  const resolve = executorResolve(node)
  if (!resolve || !callback) return false
  if (callback.type === 'Identifier') return callback.name === resolve
  if (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression') {
    const body = callback.body.type === 'BlockStatement' && callback.body.body.length === 1 ? callback.body.body[0].expression : callback.body
    return body?.type === 'CallExpression' && body.callee.type === 'Identifier' && body.callee.name === resolve
  }
  return false
}

const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'ban fixed waits in the browser suites; wait on a condition (tests/lib/harness.mjs)' },
    schema: [],
    messages: {
      fixed:
        '{{what}} is a fixed wait: wait on a condition instead (settle, until, scrollToProgress, frames in tests/lib/harness.mjs), or justify it with a `fixed-wait: <reason>` comment on this line or the line above.',
    },
  },
  create(context) {
    const source = context.sourceCode
    const allowed = new Set()
    for (const comment of source.getAllComments()) if (ALLOW.test(comment.value)) allowed.add(comment.loc.end.line)
    const report = (node, what) => {
      const line = node.loc.start.line
      if (allowed.has(line) || allowed.has(line - 1)) return
      context.report({ node, messageId: 'fixed', data: { what } })
    }
    return {
      CallExpression(node) {
        const callee = node.callee
        if (callee.type === 'MemberExpression' && !callee.computed && callee.property.name === 'waitForTimeout') return report(node, 'waitForTimeout()')
        if (callee.type === 'Identifier' && NAMES.has(callee.name)) return report(node, `${callee.name}()`)
        if (isHandRolledSleep(node)) return report(node, 'a setTimeout sleep')
      },
    }
  },
}

export default { meta: { name: 'harness' }, rules: { 'no-fixed-wait': rule } }
