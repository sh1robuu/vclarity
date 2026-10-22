import { z } from 'zod';

const integer = (fallback: number, min: number, max: number) => z.preprocess(
  (value) => value === undefined || value === '' ? fallback : Number(value),
  z.number().int().min(min).max(max),
);

const environmentSchema = z.object({
  AI_PROVIDER: z.enum(['openai', 'ollama', 'gemini']).default('openai'),
  AI_API_KEY: z.string().trim().default(''),
  AI_MODEL: z.string().trim().min(1).max(200).optional(),
  API_PORT: integer(4317, 1024, 65535),
  API_ACCESS_TOKEN: z.string().trim().min(32).max(512),
  API_EXTENSION_ID: z.string().regex(/^[a-p]{32}$/).optional(),
  AI_TIMEOUT_MS: integer(45_000, 1000, 120_000),
  API_RATE_LIMIT_PER_MINUTE: integer(10, 1, 100),
  API_MAX_CONCURRENT: integer(2, 1, 5),
});

export interface ApiConfig {
  provider: 'openai' | 'ollama' | 'gemini';
  apiKey: string;
  model: string;
  port: number;
  accessToken: string;
  extensionId?: string;
  timeoutMs: number;
  requestsPerMinute: number;
  maxConcurrent: number;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const result = environmentSchema.safeParse({ ...environment,
    AI_API_KEY: environment.AI_API_KEY || (environment.AI_PROVIDER === 'ollama' ? environment.OLLAMA_API_KEY : environment.AI_PROVIDER === 'gemini' ? environment.GEMINI_API_KEY || environment.GOOGLE_API_KEY : undefined),
    API_EXTENSION_ID: environment.API_EXTENSION_ID || undefined });
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path[0]))].join(', ');
    throw new Error(`Invalid backend configuration: ${names}. Check apps/api/.env.example. API_ACCESS_TOKEN must contain at least 32 characters.`);
  }
  const value = result.data;
  return {
    provider: value.AI_PROVIDER, apiKey: value.AI_API_KEY, model: value.AI_MODEL ?? ({ openai: 'gpt-4.1-mini', ollama: 'gpt-oss:120b', gemini: 'gemini-3.5-flash-lite' }[value.AI_PROVIDER]),
    port: value.API_PORT, accessToken: value.API_ACCESS_TOKEN,
    extensionId: value.API_EXTENSION_ID, timeoutMs: value.AI_TIMEOUT_MS,
    requestsPerMinute: value.API_RATE_LIMIT_PER_MINUTE, maxConcurrent: value.API_MAX_CONCURRENT,
  };
}
