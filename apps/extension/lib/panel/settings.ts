import { z } from 'zod';
import { connectionInfoSchema } from '@vclarity/shared';
import { usePanel } from '../../stores/panel';

export const CONNECTION_STORAGE_KEY = 'vclarity.connection.v1';
const savedConnectionSchema = z.object({ token: z.string().min(32).max(512), remember: z.literal(true) }).strict();
let revision = 0;
let check: AbortController | null = null;

function begin(): number { check?.abort(); check = null; return ++revision; }
async function storage(): Promise<chrome.storage.LocalStorageArea> {
  const area = globalThis.chrome?.storage?.local;
  if (!area) throw new Error('Chrome storage is unavailable. Open Vclarity from the installed extension.');
  await area.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  return area;
}
function savedMessage(): string {
  return usePanel.getState().rememberToken ? 'Token saved on this device.' : 'Token kept for this open panel only.';
}

async function verify(token: string, operation: number): Promise<void> {
  if (operation !== revision) return;
  const controller = new AbortController(); check = controller;
  usePanel.getState().set({ connectionStatus: 'checking', connectionInfo: null, connectionMessage: `${savedMessage()} Checking the local backend…` });
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('http://127.0.0.1:4317/connection', {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
    });
    if (operation !== revision) return;
    if (response.status === 401) {
      usePanel.getState().set({ connectionStatus: 'invalid', connectionMessage: `${savedMessage()} The backend rejected this token. Use API_ACCESS_TOKEN from apps/api/.env, then save again.` });
      return;
    }
    if (response.status === 404) throw new Error('Restart the updated backend to enable connection checks.');
    if (!response.ok) throw new Error(`The local backend returned HTTP ${response.status}.`);
    if (Number(response.headers.get('Content-Length') || 0) > 8192) throw new Error('The local backend returned an invalid connection response.');
    const body = await response.text();
    if (body.length > 8192) throw new Error('The local backend returned an invalid connection response.');
    const parsed = connectionInfoSchema.safeParse(JSON.parse(body));
    if (!parsed.success) throw new Error('The local backend returned an invalid connection response.');
    if (operation !== revision) return;
    usePanel.getState().set({ connectionStatus: 'connected', connectionInfo: parsed.data,
      connectionMessage: `${savedMessage()} Local backend and access token verified. Provider credentials and quota have not been tested.` });
  } catch (error) {
    if (operation !== revision) return;
    const reason = error instanceof TypeError ? 'Start the local backend at 127.0.0.1:4317, then choose Test connection.'
      : controller.signal.aborted ? 'The connection check timed out. Start the local backend, then retry.'
      : error instanceof SyntaxError ? 'The local backend returned an invalid connection response.'
      : error instanceof Error ? error.message : 'The local backend could not be checked.';
    usePanel.getState().set({ connectionStatus: 'disconnected', connectionInfo: null, connectionMessage: `${savedMessage()} ${reason}` });
  } finally {
    clearTimeout(timer);
    if (check === controller) check = null;
  }
}

export async function saveConnection(value: string, remember: boolean): Promise<void> {
  const token = value.trim();
  if (/^(?:AIza|AQ\.|sk-|gsk_)/.test(token)) throw new Error('This looks like a provider API key. Put it in AI_API_KEY on the server. Enter the separate API_ACCESS_TOKEN here.');
  if (token.length < 32 || token.length > 512 || /\s/.test(token) || [...token].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error('Use the local API_ACCESS_TOKEN: 32–512 characters without spaces.');
  const operation = begin();
  try {
    const area = await storage();
    if (operation !== revision) return;
    if (remember) await area.set({ [CONNECTION_STORAGE_KEY]: { token, remember: true } });
    else await area.remove(CONNECTION_STORAGE_KEY);
    if (operation !== revision) return;
    usePanel.getState().set({ token, rememberToken: remember });
  } catch {
    if (operation === revision) usePanel.getState().set({ connectionStatus: 'error', connectionMessage: 'The token could not be saved in Chrome storage. Your previous connection was kept. Retry saving.' });
    return;
  }
  await verify(token, operation);
}

export async function checkConnection(): Promise<void> {
  const operation = begin();
  const token = usePanel.getState().token;
  if (!token) {
    usePanel.getState().set({ connectionStatus: 'unconfigured', connectionMessage: 'Enter the local service access token and choose Save connection.' });
    return;
  }
  await verify(token, operation);
}

export async function forgetConnection(): Promise<void> {
  const operation = begin();
  try {
    await (await storage()).remove(CONNECTION_STORAGE_KEY);
    if (operation !== revision) return;
    usePanel.getState().set({ token: '', rememberToken: true, connectionStatus: 'unconfigured', connectionInfo: null, connectionMessage: 'Saved token removed from this device.' });
  } catch {
    if (operation === revision) usePanel.getState().set({ connectionStatus: 'error', connectionMessage: 'Chrome could not remove the saved token. Retry Forget saved token.' });
  }
}

export async function restoreConnection(): Promise<void> {
  if (usePanel.getState().token) return;
  const operation = begin();
  usePanel.getState().set({ connectionStatus: 'restoring', connectionMessage: null });
  try {
    const area = await storage();
    const values = await area.get(CONNECTION_STORAGE_KEY);
    if (operation !== revision) return;
    const raw: unknown = values[CONNECTION_STORAGE_KEY];
    if (raw === undefined) { usePanel.getState().set({ connectionStatus: 'unconfigured' }); return; }
    const parsed = savedConnectionSchema.safeParse(raw);
    if (!parsed.success) {
      await area.remove(CONNECTION_STORAGE_KEY);
      if (operation === revision) usePanel.getState().set({ connectionStatus: 'invalid', connectionMessage: 'The saved connection was invalid and has been removed. Save the local service token again.' });
      return;
    }
    usePanel.getState().set({ token: parsed.data.token, rememberToken: true });
    await verify(parsed.data.token, operation);
  } catch {
    if (operation === revision) usePanel.getState().set({ connectionStatus: 'error', connectionMessage: 'The saved token could not be restored from Chrome storage. Retry saving the connection.' });
  }
}
