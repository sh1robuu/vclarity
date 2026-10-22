import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';

const sources = {
  dom: ['Exact (DOM)', 'Browser-computed CSS and rendered geometry. These are not the original authored stylesheet declarations.'],
  pixels: ['Measured (Pixels)', 'Local dominant screenshot colors. Coverage is approximate and may include images, gradients, and antialiasing.'],
  ai: ['Estimated (AI)', 'AI interpretation of the selected image. Observations and inferred behavior require verification.'],
} as const;
export function SourceBadge({ source }: { source: keyof typeof sources }) {
  const [name, explanation] = sources[source];
  const id = useId();
  const trigger = useRef<HTMLSpanElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const focused = useRef(false);
  const hovered = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!trigger.current || !tooltip.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const content = tooltip.current.getBoundingClientRect();
      const left = Math.max(12, Math.min(anchor.left, window.innerWidth - content.width - 12));
      const below = anchor.bottom + 8;
      const top = below + content.height <= window.innerHeight - 12 ? below : Math.max(12, anchor.top - content.height - 8);
      setPosition({ left, top });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, explanation]);
  return <span className="source-badge-wrap" onMouseEnter={() => { clearTimeout(hideTimer.current); hovered.current = true; setOpen(true); }} onMouseLeave={() => { hovered.current = false; if (!focused.current) hideTimer.current = setTimeout(() => setOpen(false), 120); }}><span ref={trigger} className={`badge source-${source}`} tabIndex={0} aria-describedby={id} onFocus={() => { clearTimeout(hideTimer.current); focused.current = true; setOpen(true); }} onBlur={() => { focused.current = false; if (!hovered.current) setOpen(false); }} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}>{name}</span><span id={id} ref={tooltip} className="source-tooltip" role="tooltip" hidden={!open} style={position}>{explanation}</span></span>;
}

export function CopyButton({ text, label = 'Copy note', compact = false }: { text: string | (() => string); label?: string; compact?: boolean }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(typeof text === 'function' ? text() : text);
      setStatus('copied');
    } catch { setStatus('failed'); }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus('idle'), 2400);
  };
  return <span className="copy-control"><button type="button" className={compact ? 'icon-button copy-button' : 'text-button copy-button'} onClick={() => void copy()} aria-label={status === 'copied' ? `${label}: copied` : label} title={label}>
    {status === 'copied' ? <Check size={13} /> : <Copy size={13} />}{!compact && <span>{status === 'copied' ? 'Copied' : label}</span>}
  </button><span className={status === 'failed' ? 'copy-error' : 'sr-only'} role="status">{status === 'copied' ? 'Copied to clipboard' : status === 'failed' ? 'Copy failed. Select and copy the text manually.' : ''}</span></span>;
}

export function SectionHeading({ title, badge, action }: { title: string; badge?: ReactNode; action?: ReactNode }) {
  return <div className="section-heading"><div><h2>{title}</h2>{badge}</div>{action}</div>;
}

export const propertyName = (name: string) => name.replace(/^css-/, 'CSS ').replace(/-/g, ' ').replace(/^./, (first) => first.toUpperCase());
export function Properties({ values }: { values: Record<string, string | number | null> }) {
  return <dl className="properties">{Object.entries(values).map(([name, value]) => <div className="property" key={name}><dt>{propertyName(name)}</dt><dd className={value === null ? 'unknown' : ''}>{value ?? 'Unavailable'}</dd></div>)}</dl>;
}

export function TextList({ items, empty = 'No items returned from the available evidence.' }: { items: string[]; empty?: string }) {
  return items.length ? <ul className="text-list">{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p className="muted small">{empty}</p>;
}
