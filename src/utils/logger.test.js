import { describe, it, expect, spyOn, beforeEach } from 'bun:test';
import logger from '../utils/logger.js';

describe('Logger Utility', () => {
  let consoleLogSpy;
  let consoleWarnSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
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
