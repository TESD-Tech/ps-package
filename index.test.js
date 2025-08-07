import { describe, it, expect, vi } from 'vitest';
import * as mainModule from './src/main.js'; // Import main as a module

describe('index.js', () => {
  it('should call main() when executed', async () => {
    const mainSpy = vi.spyOn(mainModule, 'main').mockResolvedValueOnce();

    // Dynamically import index.js to trigger its execution
    // This ensures the top-level code in index.js runs
    await import('./index.js');

    expect(mainSpy).toHaveBeenCalledTimes(1);
  });
});
