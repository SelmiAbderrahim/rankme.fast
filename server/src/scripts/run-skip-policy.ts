/** CLI wrapper for the repository's zero-exception static test policy. */
import { runTestPolicy } from './skip-policy.js';
process.exitCode = runTestPolicy(process.argv.slice(2), {
    out: (message) => console.log(message),
    error: (message) => console.error(message),
});
