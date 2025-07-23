import { describe, it, expect, vi } from 'vitest';
import { getNewVersion } from './src/main.js';

describe('getNewVersion', () => {
  it('should increment the patch version', async () => {
    const newVersion = await getNewVersion('24.1.1');
    expect(newVersion).toBe('25.07.01');
  });
});
