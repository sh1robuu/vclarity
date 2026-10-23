import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, Check, ExternalLink, LoaderCircle, X } from 'lucide-react';
import { openShortcuts } from '../lib/panel/client';
import { checkConnection, forgetConnection, saveConnection } from '../lib/panel/settings';
import { usePanel } from '../stores/panel';

const statusLabels = {
  unconfigured: 'No connection saved',
  restoring: 'Restoring saved connection…',
  checking: 'Checking local service…',
  connected: 'Local service connected',
  disconnected: 'Local service unavailable',
  invalid: 'Connection needs attention',
  error: 'Connection needs attention',
} as const;

export function ConnectionSettings({ onClose }: { onClose: () => void }) {
  const { token, rememberToken, connectionStatus, connectionMessage, connectionInfo } = usePanel();
  const [draft, setDraft] = useState(token);
  const [remember, setRemember] = useState(rememberToken);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { setDraft(token); setRemember(rememberToken); }, [token, rememberToken]);
  const busy = pending || connectionStatus === 'restoring' || connectionStatus === 'checking';
  const dirty = draft.trim() !== token || remember !== rememberToken;
  const run = async (action: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The connection could not be updated. Please retry.'); }
    finally { setPending(false); }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!busy && draft.trim()) void run(() => saveConnection(draft.trim(), remember));
  };
  const successful = connectionStatus === 'connected';
  const needsAttention = ['disconnected', 'invalid', 'error'].includes(connectionStatus);
  return <section className="settings" id="settings" aria-label="Settings">
    <div className="section-heading"><h2>Connection & shortcuts</h2><button className="icon-button" type="button" aria-label="Close settings" onClick={onClose}><X size={14} /></button></div>
    <form onSubmit={submit} aria-label="Local service connection">
      <label htmlFor="service-token">Local service access token</label>
      <input ref={input} id="service-token" type="password" value={draft} autoComplete="off" spellCheck={false} placeholder="Matches API_ACCESS_TOKEN on your server" disabled={busy} aria-describedby="token-help token-storage" onChange={(event) => { setDraft(event.target.value); setError(null); }} />
      <p className="fine-print" id="token-help">Use <code>API_ACCESS_TOKEN</code> from your local server. Gemini, Ollama, and OpenAI provider keys belong in the server configuration.</p>
      <label className="checkbox-row settings-remember"><input type="checkbox" data-testid="settings-remember" checked={remember} disabled={busy} onChange={(event) => setRemember(event.target.checked)} /><span>Remember this local service token on this device</span></label>
      <p className="fine-print" id="token-storage">{remember ? 'Saved in this extension’s local Chrome storage on this device. Screenshots are never saved there.' : 'Kept only while this panel is open. Reopening the panel will require the token again.'}</p>
      <div className="settings-actions">
        <button className="primary-button" type="submit" data-testid="settings-save" disabled={busy || !draft.trim()}>{busy ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />}Save connection</button>
        <button className="secondary-button" type="button" data-testid="settings-test" disabled={busy || !token || dirty} onClick={() => void run(checkConnection)}>Test connection</button>
      </div>
      {dirty && !busy && <p className="fine-print unsaved-note">Changes are not saved yet. Press Enter or choose Save connection.</p>}
      <div className={`connection-status ${successful ? 'connected' : needsAttention ? 'needs-attention' : ''}`} data-testid="settings-status" role="status" aria-live="polite" aria-atomic="true">
        {busy ? <LoaderCircle size={14} className="spin" /> : successful ? <Check size={14} /> : needsAttention ? <AlertCircle size={14} /> : <span className="status-dot" />}
        <div><strong>{statusLabels[connectionStatus]}</strong>{connectionMessage && <p>{connectionMessage}</p>}{connectionInfo && <p>{connectionInfo.provider === 'openai' ? 'OpenAI' : connectionInfo.provider === 'gemini' ? 'Gemini' : 'Ollama'} · <code>{connectionInfo.model}</code>{!connectionInfo.aiConfigured ? ' · Provider key missing on server' : connectionInfo.imageAnalysisSupported === false ? ' · Image analysis unavailable for this model' : ''}</p>}</div>
      </div>
      {error && <p className="inline-error small" role="alert">{error}</p>}
      {token && <button className="text-button forget-token" type="button" data-testid="settings-forget" disabled={busy} onClick={() => void run(forgetConnection)}>Forget saved token</button>}
    </form>
    <div className="service-address"><span>API endpoint</span><code>127.0.0.1:4317</code></div>
    <button type="button" className="text-button accent" onClick={() => void run(openShortcuts)}>Customize Chrome shortcuts <ExternalLink size={12} /></button>
    <p className="fine-print">Shortcuts shown below are Chrome's current assignments. Unassigned or reserved shortcuts can be changed in Chrome.</p>
  </section>;
}
