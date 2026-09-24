import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./worker.ts', import.meta.url), 'utf8');

describe('worker team database wiring', () => {
  it('initializes the team holder before invitation reconciliation can run', () => {
    expect(source).toMatch(
      /import \{ reconcileTeamInvitations, setTeamDb \} from '\.\/modules\/team\/index\.js';/u,
    );
    const initialization = source.indexOf('setTeamDb(db);');
    const reconciliation = source.indexOf('run: () => reconcileTeamInvitations()');
    expect(initialization).toBeGreaterThan(-1);
    expect(reconciliation).toBeGreaterThan(initialization);
  });
});
