import pino, { type Logger } from 'pino';

/**
 * Creates the application logger. Sensitive fields are redacted so passwords,
 * tokens, and payment details never reach log output.
 */
export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: [
        'password',
        '*.password',
        'password_hash',
        '*.password_hash',
        'token',
        '*.token',
        'authorization',
        '*.authorization',
        'req.headers.authorization',
        'card_number',
        '*.card_number',
        'cvv',
        '*.cvv',
      ],
      censor: '[REDACTED]',
    },
  });
}

export type { Logger };
