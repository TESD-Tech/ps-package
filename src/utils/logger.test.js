import { describe, it, expect, vi, beforeEach } from 'vitest';
import logger from '../utils/logger.js';

describe('Logger Utility', () => {
  let consoleLogSpy;
  let consoleWarnSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should log info messages correctly', () => {
    const message = 'This is an info message';
    logger.info(message);
    expect(consoleLogSpy).toHaveBeenCalledWith('[INFO]', message);
  });

  it('should log warn messages correctly', () => {
    const message = 'This is a warning message';
    logger.warn(message);
    expect(consoleWarnSpy).toHaveBeenCalledWith('[WARN]', message);
  });

  it('should log error messages correctly', () => {
    const message = 'This is an error message';
    logger.error(message);
    expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR]', message);
  });
});
