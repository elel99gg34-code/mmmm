/**
 * A ~60-line test harness. No dependencies, because a game hub should not need
 * a build step to check that its rules are right.
 */

export const state = { passed: 0, failed: 0, failures: [], suite: '' };

export function suite(name) {
  state.suite = name;
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

export function test(name, fn) {
  try {
    fn();
    state.passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    state.failed++;
    state.failures.push({ suite: state.suite, name, err });
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    \x1b[31m${err.message}\x1b[0m`);
  }
}

/** Same as `test`, for a body that needs `await`. Call it with `await`. */
export async function testAsync(name, fn) {
  try {
    await fn();
    state.passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    state.failed++;
    state.failures.push({ suite: state.suite, name, err });
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    \x1b[31m${err.message}\x1b[0m`);
  }
}

export function assert(condition, message = 'assertion failed') {
  if (!condition) throw new Error(message);
}

export function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function deepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(message || `expected ${b}, got ${a}`);
}

export function throwsError(fn, message) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(message || 'expected the call to throw');
}

/** Print the summary and return the process exit code. */
export function report() {
  console.log(`\n${state.passed} passed, ${state.failed} failed`);
  if (!state.failed) return 0;
  console.log('\nFailures:');
  for (const f of state.failures) console.log(`\n  ${f.suite} › ${f.name}\n${f.err.stack}`);
  return 1;
}
