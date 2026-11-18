import { describe, expect, it } from 'vitest';
import { flag } from '../src/config/env.js';

describe('flag (DASHBOARD_TOKEN_RESET)', () => {
  it('accepts 1, true and yes in any case', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'Yes']) expect(flag.parse(v), v).toBe(true);
  });
  it('is false when unset, empty or anything else', () => {
    for (const v of [undefined, '', '0', 'false', 'no', 'off']) expect(flag.parse(v), String(v)).toBe(false);
  });
});
