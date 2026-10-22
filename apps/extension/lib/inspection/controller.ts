import { contentEventSchema, inspectorCommandSchema, type ContentEvent, type Rect, type Viewport } from '@vclarity/shared';
import { deepestElementAt, describeElement, extractElement } from './extract';

export function viewportSnapshot(): Viewport {
  const visual = window.visualViewport;
  return { width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY,
    devicePixelRatio: window.devicePixelRatio, visualOffsetX: visual?.offsetLeft ?? 0,
    visualOffsetY: visual?.offsetTop ?? 0, visualScale: visual?.scale ?? 1 };
}
export function sameViewport(a: Viewport, b: Viewport): boolean {
  return Object.keys(a).every(key => Math.abs(a[key as keyof Viewport] - b[key as keyof Viewport]) < 0.01);
}
export function normalizeRegion(start: { x: number; y: number }, end: { x: number; y: number }, width: number, height: number): Rect | null {
  const x = Math.max(0, Math.min(start.x, end.x, width));
  const y = Math.max(0, Math.min(start.y, end.y, height));
  const right = Math.max(0, Math.min(Math.max(start.x, end.x), width));
  const bottom = Math.max(0, Math.min(Math.max(start.y, end.y), height));
  if (right - x < 8 || bottom - y < 8) return null;
  return { x, y, width: right - x, height: bottom - y };
}

export function installInspector(): () => void {
  let teardown: (() => void) | undefined;
  let captureWatch: { scrolled: boolean; checks: number; dispose: () => void } | null = null;
  const clearWatch = () => { captureWatch?.dispose(); captureWatch = null; };
  const stop = () => { teardown?.(); teardown = undefined; clearWatch(); };
  const send = (event: ContentEvent) => {
    const parsed = contentEventSchema.safeParse(event);
    const bounded: ContentEvent = parsed.success ? parsed.data : { type: 'SELECTION_CANCELLED', sessionId: event.sessionId, reason: 'This element has metadata beyond the supported limits. Select a smaller or simpler element.' };
    void chrome.runtime.sendMessage(bounded).catch(() => stop());
  };

  const begin = (mode: 'live' | 'ghost', sessionId: string) => {
    stop();
    const snapshot = viewportSnapshot();
    const host = document.createElement('div');
    host.dataset.vclarityOverlay = '';
    host.style.cssText = 'position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:auto!important;touch-action:none!important;contain:strict!important;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = ':host{all:initial}.outline{position:absolute;box-sizing:border-box;border:1px solid #365cf5;background:rgba(54,92,245,.07);pointer-events:none}.label{position:absolute;background:#15171c;color:white;padding:5px 8px;border-radius:5px;font:11px/1.4 ui-monospace,monospace;white-space:nowrap;max-width:calc(100vw - 16px);overflow:hidden;text-overflow:ellipsis}.shade{position:absolute;background:rgba(13,20,38,.28);pointer-events:none}.hint{position:absolute;top:14px;left:50%;transform:translateX(-50%);background:#15171c;color:white;padding:8px 12px;border-radius:7px;font:12px/1.4 system-ui;white-space:nowrap}';
    const outline = document.createElement('div'); outline.className = 'outline'; outline.hidden = true;
    const label = document.createElement('div'); label.className = 'label'; label.hidden = true;
    const hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = mode === 'live' ? 'Select an element · Esc to cancel' : 'Drag to select a region · Esc to cancel';
    const shades = Array.from({ length: 4 }, () => { const shade = document.createElement('div'); shade.className = 'shade'; return shade; });
    shadow.append(style, ...shades, outline, label, hint);
    document.documentElement.append(host);
    // A temporary stylesheet supplies the cursor without mutating existing element styles.
    const cursor = document.createElement('style');
    cursor.textContent = '*{cursor:crosshair!important}'; document.documentElement.append(cursor);
    const listeners = new AbortController();
    let raf = 0;
    let target: Element | null = null;
    let last = { x: 0, y: 0 };
    let origin: { x: number; y: number } | null = null;
    let activePointer: number | null = null;
    let finished = false;
    let finishing = false;
    let finishTimer: ReturnType<typeof setTimeout> | undefined;
    // Briefly exclude our hit surface from hit testing, including open shadow roots.
    const targetAt = (x: number, y: number) => {
      host.style.setProperty('pointer-events', 'none', 'important');
      const element = deepestElementAt(x, y);
      host.style.setProperty('pointer-events', 'auto', 'important');
      return element;
    };
    const setBox = (node: HTMLElement, rect: Rect) => {
      node.style.left = `${rect.x}px`; node.style.top = `${rect.y}px`;
      node.style.width = `${rect.width}px`; node.style.height = `${rect.height}px`;
    };
    const draw = (rect: Rect, name = '') => {
      outline.hidden = false; label.hidden = false;
      setBox(outline, rect);
      label.textContent = `${name ? `${name} · ` : ''}${rect.width} × ${rect.height}`;
      label.style.left = `${Math.max(8, Math.min(rect.x, window.innerWidth - 200))}px`;
      label.style.top = `${rect.y >= 35 ? rect.y - 29 : Math.min(window.innerHeight - 32, rect.y + rect.height + 5)}px`;
      if (mode === 'ghost') {
        const w = window.innerWidth, h = window.innerHeight;
        [ { x: 0, y: 0, width: w, height: rect.y }, { x: 0, y: rect.y, width: rect.x, height: rect.height },
          { x: rect.x + rect.width, y: rect.y, width: w - rect.x - rect.width, height: rect.height },
          { x: 0, y: rect.y + rect.height, width: w, height: h - rect.y - rect.height } ].forEach((box, i) => setBox(shades[i]!, box));
      }
    };
    const cleanup = () => {
      finished = true; clearTimeout(finishTimer); listeners.abort(); cancelAnimationFrame(raf); host.remove(); cursor.remove();
      if (teardown === cleanup) teardown = undefined;
    };
    teardown = cleanup;
    const cancel = (reason: string) => { if (finished) return; cleanup(); send({ type: 'SELECTION_CANCELLED', sessionId, reason }); };
    const intercept = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const opts = { capture: true, signal: listeners.signal, passive: false };
    window.addEventListener('pointermove', (event: PointerEvent) => {
      last = { x: event.clientX, y: event.clientY };
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (mode === 'live') {
          target = targetAt(last.x, last.y);
          if (target && target !== host && target.isConnected) {
            const rect = target.getBoundingClientRect();
            draw({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }, describeElement(target));
          }
        } else if (origin) {
          const region = normalizeRegion(origin, last, snapshot.width, snapshot.height);
          if (region) draw(region);
        }
      });
    }, opts);
    window.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.button !== 0) { cancel('Selection cancelled. Use the primary pointer button.'); return; }
      intercept(event);
      activePointer = event.pointerId;
      origin = { x: event.clientX, y: event.clientY };
    }, opts);
    window.addEventListener('pointerup', (event: PointerEvent) => {
      intercept(event);
      if (!origin || event.pointerId !== activePointer) return;
      if (!sameViewport(snapshot, viewportSnapshot())) { cancel('The viewport changed. Select the region again.'); return; }
      if (mode === 'live') {
        target = targetAt(event.clientX, event.clientY);
        if (!target) { cancel('No visible element was found.'); return; }
        try { const element = extractElement(target); finishAfterClick(() => send({ type: 'ELEMENT_SELECTED', sessionId, element })); }
        catch (error) { cancel(error instanceof Error ? error.message : 'This element cannot be inspected.'); }
      } else {
        const region = normalizeRegion(origin, { x: event.clientX, y: event.clientY }, snapshot.width, snapshot.height);
        if (!region) { cancel('Select an area at least 8 × 8 CSS pixels.'); return; }
        // Keep a bounded watcher through compositor/capture work, including nested
        // scroll containers that do not change window.scrollX/scrollY.
        const controller = new AbortController();
        const timer = setTimeout(clearWatch, 10_000);
        captureWatch = { scrolled: false, checks: 0, dispose: () => { controller.abort(); clearTimeout(timer); } };
        window.addEventListener('scroll', () => { if (captureWatch) captureWatch.scrolled = true; }, { capture: true, signal: controller.signal });
        finishAfterClick(() => {
          // Two frames ensure temporary overlay removal has reached the compositor.
          requestAnimationFrame(() => requestAnimationFrame(() => send({ type: 'REGION_SELECTED', sessionId, region, viewport: snapshot })));
        });
      }
    }, opts);
    // Keep the hit surface through the click generated in this pointerup task,
    // then remove it before reporting. No listener can swallow a later user click.
    const finishAfterClick = (notify: () => void) => {
      if (finished || finishing) return;
      finishing = true;
      finishTimer = setTimeout(() => { if (finished) return; cleanup(); notify(); }, 0);
    };
    window.addEventListener('click', intercept, opts);
    window.addEventListener('mousedown', intercept, opts);
    window.addEventListener('mouseup', intercept, opts);
    window.addEventListener('keydown', (event: KeyboardEvent) => { if (event.key === 'Escape') { intercept(event); cancel('Inspection cancelled.'); } }, opts);
    window.addEventListener('wheel', (event: WheelEvent) => { intercept(event); cancel('Scrolling cancelled this selection. Select again after scrolling.'); }, opts);
    window.addEventListener('scroll', () => cancel('The page scrolled. Select again at the current position.'), { capture: true, signal: listeners.signal });
    window.addEventListener('resize', () => cancel('The viewport resized. Select again.'), { signal: listeners.signal });
    window.addEventListener('blur', () => cancel('The page lost focus. Start inspection again.'), { signal: listeners.signal });
    window.addEventListener('pagehide', cleanup, { signal: listeners.signal });
    window.addEventListener('pointercancel', () => cancel('Pointer selection cancelled.'), opts);
  };
  const onMessage = (raw: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => {
    if (sender.id !== chrome.runtime.id) return;
    const parsed = inspectorCommandSchema.safeParse(raw);
    if (!parsed.success) return;
    const command = parsed.data;
    if (command.type === 'PING') respond({ ok: true });
    if (command.type === 'STOP') { stop(); respond({ ok: true }); }
    if (command.type === 'VERIFY_VIEWPORT') {
      const ok = !!captureWatch && !captureWatch.scrolled && sameViewport(command.viewport, viewportSnapshot()) && !document.hidden;
      if (captureWatch && ++captureWatch.checks >= 2) clearWatch();
      respond({ ok });
    }
    if (command.type === 'INSPECT') { begin(command.mode, command.sessionId); respond({ ok: true }); }
  };
  chrome.runtime.onMessage.addListener(onMessage);
  return () => { stop(); chrome.runtime.onMessage.removeListener(onMessage); };
}
