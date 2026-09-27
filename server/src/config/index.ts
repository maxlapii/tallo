import { z } from 'zod';

/**
 * Application configuration, loaded from environment variables and validated
 * once at startup. Invalid or missing required values fail fast.
 */
const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATA_DIR: z.string().min(1).default('./data'),
  DEMO_STORE: z.string().min(1).default('demo'),
  ALLOW_SIGNUP: z.enum(['true', 'false']).default('true'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().min(1).default('8h'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  STORE_NAME: z.string().min(1).default('Tallo'),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  dataDir: string;
  demoStore: string;
  allowSignup: boolean;
  jwtSecret: string;
  jwtExpiresIn: string;
  logLevel: z.infer<typeof configSchema>['LOG_LEVEL'];
  storeName: string;
  loginRateLimit: { max: number; windowMs: number };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const c = parsed.data;
  return {
    nodeEnv: c.NODE_ENV,
    port: c.PORT,
    dataDir: c.DATA_DIR,
    demoStore: c.DEMO_STORE,
    allowSignup: c.ALLOW_SIGNUP === 'true',
    jwtSecret: c.JWT_SECRET,
    jwtExpiresIn: c.JWT_EXPIRES_IN,
    logLevel: c.LOG_LEVEL,
    storeName: c.STORE_NAME,
    loginRateLimit: { max: c.LOGIN_RATE_LIMIT_MAX, windowMs: c.LOGIN_RATE_LIMIT_WINDOW_MS },
  };
}
