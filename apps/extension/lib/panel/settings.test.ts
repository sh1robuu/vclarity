import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePanel } from '../../stores/panel';
import { checkConnection, CONNECTION_STORAGE_KEY, forgetConnection, restoreConnection, saveConnection } from './settings';

const token = 'local-service-test-token-with-32-characters';
const metadata = { provider: 'gemini', model: 'configured-model', aiConfigured: true, imageAnalysisSupported: null };
let values: Record<string, unknown>;
let area: { setAccessLevel: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };

beforeEach(() => {
  values = {};
  area = {
    setAccessLevel: vi.fn(async () => undefined),
    get: vi.fn(async () => ({ ...values })),
    set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(values, items); }),
    remove: vi.fn(async (key: string) => { delete values[key]; }),
  };
  vi.stubGlobal('chrome', { storage: { local: area } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(metadata))));
  usePanel.getState().set({ token: '', rememberToken: true, connectionStatus: 'unconfigured', connectionMessage: null, connectionInfo: null });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('explicit local service connection settings', () => {
  it('persists only the local token and validates the authenticated backend without an image', async () => {
    await saveConnection(` ${token} `, true);
    expect(area.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    expect(values).toEqual({ [CONNECTION_STORAGE_KEY]: { token, remember: true } });
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:4317/connection', expect.objectContaining({ headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }));
    expect(usePanel.getState().connectionStatus).toBe('connected');
    expect(usePanel.getState().connectionMessage).toContain('Token saved');
    expect(usePanel.getState().connectionInfo).toEqual(metadata);
  });
  it('restores saved credentials when a new panel starts', async () => {
    values[CONNECTION_STORAGE_KEY] = { token, remember: true };
    await restoreConnection();
    expect(usePanel.getState().token).toBe(token);
    expect(usePanel.getState().connectionStatus).toBe('connected');
  });
  it('saves offline and explains that connection has not been verified', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await saveConnection(token, true);
    expect(values[CONNECTION_STORAGE_KEY]).toEqual({ token, remember: true });
    expect(usePanel.getState().connectionStatus).toBe('disconnected');
    expect(usePanel.getState().connectionMessage).toContain('Token saved');
    expect(usePanel.getState().connectionMessage).toContain('Start the local backend');
  });
  it('removes persistence when remember is disabled but keeps the active token', async () => {
    await saveConnection(token, true);
    await saveConnection(token, false);
    expect(values).toEqual({});
    expect(usePanel.getState().token).toBe(token);
    expect(usePanel.getState().connectionMessage).toContain('open panel only');
  });
  it('reports authentication failure without pretending the backend is connected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    await saveConnection(token, true);
    expect(usePanel.getState().connectionStatus).toBe('invalid');
    expect(usePanel.getState().connectionInfo).toBeNull();
    expect(usePanel.getState().connectionMessage).toContain('rejected');
  });
  it('rejects provider keys and short tokens before persisting or sending them', async () => {
    await expect(saveConnection('AQ.example-provider-key-that-must-stay-on-server', true)).rejects.toThrow('provider API key');
    await expect(saveConnection('short', true)).rejects.toThrow('32–512');
    expect(area.set).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('leaves previous active settings intact when Chrome storage fails', async () => {
    usePanel.getState().set({ token: 'previous-service-token' });
    area.set.mockRejectedValueOnce(new Error('disk failure'));
    await saveConnection(token, true);
    expect(usePanel.getState().token).toBe('previous-service-token');
    expect(usePanel.getState().connectionStatus).toBe('error');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('removes malformed saved settings rather than trusting persisted data', async () => {
    values[CONNECTION_STORAGE_KEY] = { token: 'bad', remember: true, image: 'unexpected' };
    await restoreConnection();
    expect(values).toEqual({});
    expect(usePanel.getState().token).toBe('');
    expect(usePanel.getState().connectionStatus).toBe('invalid');
  });
  it('never lets a late connection response resurrect a forgotten token', async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    const saving = saveConnection(token, true);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await forgetConnection();
    finish(new Response(JSON.stringify(metadata))); await saving;
    expect(values).toEqual({}); expect(usePanel.getState().token).toBe('');
    expect(usePanel.getState().connectionStatus).toBe('unconfigured');
  });
  it('tests existing settings without rewriting local storage', async () => {
    usePanel.getState().set({ token });
    await checkConnection();
    expect(area.set).not.toHaveBeenCalled();
    expect(usePanel.getState().connectionStatus).toBe('connected');
  });
});
