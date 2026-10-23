import { defineBackground } from 'wxt/utils/define-background';
import { contentEventSchema, panelCommandSchema, type BackgroundEvent, type CommandResult } from '@vclarity/shared';
import { InspectionCoordinator, captureErrorMessage, publicError, sanitizePageUrl, type TabContext } from '../lib/background/coordinator';
import { readReport, removeReport, writeReport } from '../lib/background/storage';

export default defineBackground(() => {
  // Inspector content scripts never need access to saved local credentials.
  void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => undefined);
  const queues = new Map<number, Promise<unknown>>();
  const panels = new Map<chrome.runtime.Port, number>();
  const locks = new Map<number, Promise<void>>();
  function serial<T>(tabId: number, task: () => Promise<T>): Promise<T> {
    const previous = queues.get(tabId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    queues.set(tabId, next);
    void next.finally(() => { if (queues.get(tabId) === next) queues.delete(tabId); }).catch(() => undefined);
    return next;
  }
  const publish = async (event: BackgroundEvent) => { await chrome.runtime.sendMessage(event).catch(() => undefined); };
  const tabContext = (tab: chrome.tabs.Tab): TabContext => {
    if (tab.id === undefined) throw new Error('No website tab is available. Open a website and click Vclarity.');
    return { id: tab.id, windowId: tab.windowId, url: sanitizePageUrl(tab.url ?? ''), active: tab.active };
  };
  const coordinator = new InspectionCoordinator({
    read: readReport, write: writeReport,
    tab: async id => tabContext(await chrome.tabs.get(id)),
    active: async windowId => { const [tab] = await chrome.tabs.query(windowId === undefined ? { active: true, lastFocusedWindow: true } : { active: true, windowId }); if (!tab) throw new Error('No active tab is available.'); return tabContext(tab); },
    inspect: async (tabId, command) => chrome.tabs.sendMessage(tabId, command, { frameId: 0 }),
    inject: async tabId => { await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['inspector.js'], world: 'ISOLATED' }); },
    capture: async (windowId, tabId) => {
      // captureVisibleTab has a two-calls/second browser quota. Serialize per window.
      const previous = locks.get(windowId) ?? Promise.resolve();
      let release = () => {};
      const lock = new Promise<void>(resolve => { release = resolve; });
      locks.set(windowId, lock);
      await previous;
      try {
        const [active] = await chrome.tabs.query({ active: true, windowId });
        if (active?.id !== tabId) throw new Error('The active tab changed before capture. Select again.');
        try { return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' }); }
        catch (error) { throw new Error(captureErrorMessage(error)); }
      } finally { setTimeout(() => { release(); if (locks.get(windowId) === lock) locks.delete(windowId); }, 550); }
    },
    publish: async event => {
      if (event.type === 'CAPTURE') {
        // Delivery is acknowledged by the panel itself; an idle worker can restart
        // without reconstructing its in-memory set of connected ports first.
        const receipt: unknown = await chrome.runtime.sendMessage(event).catch(() => null);
        if (!receipt || typeof receipt !== 'object' || !('accepted' in receipt) || receipt.accepted !== true) throw new Error('The side panel is unavailable. Reopen Vclarity and capture again.');
      } else await publish(event);
    },
    id: () => crypto.randomUUID(), now: () => new Date().toISOString(),
  });
  const isPanel = (sender: chrome.runtime.MessageSender) => sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('sidepanel.html');
  chrome.runtime.onMessage.addListener((raw: unknown, sender, respond: (result: CommandResult) => void) => {
    const panel = panelCommandSchema.safeParse(raw);
    const content = contentEventSchema.safeParse(raw);
    let operation: Promise<CommandResult>;
    if (panel.success && isPanel(sender)) {
      const command = panel.data;
      if (command.type === 'GET_CONTEXT') operation = coordinator.context(command.windowId).then(context => ({ ok: true as const, ...context }));
      else operation = serial(command.tabId, async () => ({ ok: true as const, report: command.type === 'START' ? await coordinator.start(command.tabId, command.mode) : await coordinator.panel(command) }));
    } else if (content.success && sender.id === chrome.runtime.id && sender.tab?.id !== undefined && sender.frameId === 0) {
      const tabId = sender.tab.id;
      operation = serial(tabId, async () => ({ ok: true as const, report: await coordinator.content(tabId, content.data) }));
    } else return;
    void operation.then(respond).catch(error => respond({ ok: false, error: publicError(error) }));
    return true;
  });
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'vclarity-panel' || !port.sender || !isPanel(port.sender)) { port.disconnect(); return; }
    port.onMessage.addListener((raw: unknown) => {
      if (raw && typeof raw === 'object' && 'type' in raw && raw.type === 'BIND' && 'windowId' in raw && Number.isInteger(raw.windowId)) panels.set(port, raw.windowId as number);
    });
    port.onDisconnect.addListener(() => {
      const windowId = panels.get(port);
      panels.delete(port);
      if (windowId === undefined || [...panels.values()].includes(windowId)) return;
      void chrome.storage.session.get(null).then(all => Promise.all(Object.keys(all).filter(key => key.startsWith('report:')).map(key => {
        const tabId = Number(key.slice(7));
        return serial(tabId, async () => { const tab = await chrome.tabs.get(tabId).catch(() => null); if (tab?.windowId === windowId) await coordinator.cancel(tabId, 'The side panel closed. Start a new inspection to continue.'); });
      }))).catch(() => undefined);
    });
  });
  const broadcastContext = async (windowId: number) => { const context = await coordinator.context(windowId); await publish({ type: 'CONTEXT', windowId, ...context }); };
  chrome.action.onClicked.addListener(tab => {
    // Call open synchronously inside the user gesture before awaiting other work.
    void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
    void broadcastContext(tab.windowId).catch(() => undefined);
  });
  chrome.commands.onCommand.addListener((command, tab) => {
    if (!['live-inspect', 'ghost-inspect'].includes(command) || tab?.id === undefined) return;
    const tabId = tab.id;
    const opening = chrome.sidePanel.open({ windowId: tab.windowId });
    void opening.then(() => serial(tabId, () => coordinator.start(tabId, command === 'live-inspect' ? 'live' : 'ghost'))).catch(() => undefined);
  });
  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    void chrome.tabs.query({ windowId }).then(tabs => Promise.all(tabs.filter(tab => tab.id !== undefined && tab.id !== tabId).map(tab => serial(tab.id!, () => coordinator.cancel(tab.id!, 'The active tab changed. Start a new inspection.'))))).then(() => broadcastContext(windowId)).catch(() => undefined);
  });
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status !== 'loading' && !change.url) return;
    void serial(tabId, async () => { await coordinator.cancel(tabId, 'The page navigated. Start a new inspection.'); await removeReport(tabId); const tab = await chrome.tabs.get(tabId); await broadcastContext(tab.windowId); }).catch(() => undefined);
  });
  chrome.tabs.onRemoved.addListener(tabId => { void serial(tabId, () => removeReport(tabId)); });
  chrome.windows.onFocusChanged.addListener(windowId => { if (windowId >= 0) void broadcastContext(windowId).catch(() => undefined); });
});
