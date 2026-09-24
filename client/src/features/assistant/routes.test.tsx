import { describe, expect, it } from 'vitest';
import { rootReducer } from '@app/store';
import { assistantRoutes } from './routes';

describe('assistant routes', () => {
  it('mounts /assistant behind a lazy verified route and injects its reducer', async () => {
    const route = assistantRoutes[0]!;
    expect(route.path).toBe('assistant');
    expect(route.lazy).toBeDefined();

    const resolved = await route.lazy!();
    expect(resolved.element).toBeTruthy();
    expect(rootReducer(undefined, { type: '@@assistant/probe' })).toHaveProperty(
      'assistant',
    );
  });
});
