import 'dotenv/config';
import { loadConfig } from '../src/config';

// Read-only credential/model check. Never print credentials or raw provider errors.
const config = loadConfig();
if (config.provider !== 'gemini' || !config.apiKey) {
  console.error('Configure AI_PROVIDER=gemini and a server-side AI_API_KEY first.');
  process.exitCode = 1;
} else {
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}`, {
      headers: { 'x-goog-api-key': config.apiKey }, redirect: 'error', signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      let reason: string | undefined;
      try {
        const value: unknown = await response.json();
        if (value && typeof value === 'object' && 'error' in value && value.error && typeof value.error === 'object' && 'details' in value.error && Array.isArray(value.error.details)) {
          for (const detail of value.error.details) {
            if (detail && typeof detail === 'object' && 'reason' in detail && typeof detail.reason === 'string' && /^[A-Z_]{1,80}$/.test(detail.reason)) reason = detail.reason;
          }
        }
      } catch { /* Only allowlisted reason codes may be logged. */ }
      console.log(JSON.stringify({ ok: false, provider: 'gemini', model: config.model, status: response.status, ...(reason ? { reason } : {}) }));
      process.exitCode = 1;
    } else {
      const value: unknown = await response.json();
      const valid = value && typeof value === 'object' && 'name' in value && value.name === `models/${config.model}`;
      console.log(JSON.stringify({ ok: !!valid, provider: 'gemini', model: config.model, status: response.status, authenticated: true }));
      if (!valid) process.exitCode = 1;
    }
  } catch {
    console.error('The Gemini model check could not complete. Check network connectivity and try again.');
    process.exitCode = 1;
  }
}
