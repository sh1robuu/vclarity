import type { ElementSpecs, Rect } from '@vclarity/shared';

export function cssValue(value: string): string | null { return value.trim() || null; }
export function measuredRect(rect: DOMRect): Rect {
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) throw new Error('The element has no visible dimensions. Select another element.');
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}
export function readProperties(style: CSSStyleDeclaration, keys: string[]): Record<string, string | null> {
  return Object.fromEntries(keys.map(key => [key, cssValue(style.getPropertyValue(key))]));
}
function layoutProperties(style: CSSStyleDeclaration): Record<string, string | null> {
  const keys = ['display', 'position', 'overflow-x', 'overflow-y'];
  if (style.display.includes('flex')) keys.push('flex-direction', 'align-items', 'justify-content', 'flex-wrap', 'gap', 'row-gap', 'column-gap');
  if (style.display.includes('grid')) keys.push('grid-template-columns', 'grid-template-rows', 'grid-auto-flow', 'align-items', 'justify-items', 'gap', 'row-gap', 'column-gap');
  if (style.position !== 'static') keys.push('z-index', 'top', 'right', 'bottom', 'left');
  return readProperties(style, keys);
}
function parentElementAcrossShadow(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}
export function describeElement(element: Element): string {
  const id = element.getAttribute('id');
  const classes = [...element.classList].slice(0, 2).map(name => `.${CSS.escape(name)}`).join('');
  return `${element.localName}${id ? `#${CSS.escape(id)}` : classes}`.slice(0, 500);
}
export function extractElement(element: Element): ElementSpecs {
  if (!element.isConnected) throw new Error('This element was removed by the page. Inspect it again.');
  const style = getComputedStyle(element);
  const parent = parentElementAcrossShadow(element);
  const limitations = [
    'Exact (DOM) means browser-computed values and rendered geometry, not original stylesheet declarations. Inherited values are resolved; percentages and auto margins may become pixels.',
    'The bounding rectangle includes transforms and fractional pixels. CSS width/height use the CSS box model. Font family does not prove the font used for each glyph.',
  ];
  if (element.localName === 'iframe') limitations.push('Only the iframe element is measured. Frame internals are not inspected, including cross-origin frames.');
  if (element.shadowRoot) limitations.push('Open Shadow DOM descendants can be selected. Closed shadow-root internals are inaccessible.');
  if (style.transform !== 'none') limitations.push('This element is transformed. Its rendered bounding rectangle may differ from CSS dimensions.');
  if (element.namespaceURI?.includes('svg')) limitations.push('SVG geometry is a rendered axis-aligned bounding rectangle; CSS box properties may not describe SVG paths.');
  const pseudoElements: ElementSpecs['pseudoElements'] = [];
  for (const pseudo of ['::before', '::after']) {
    const pseudoStyle = getComputedStyle(element, pseudo);
    if (pseudoStyle.content && !['none', 'normal'].includes(pseudoStyle.content)) {
      pseudoElements.push({ pseudo, properties: readProperties(pseudoStyle, ['display', 'color', 'background-color', 'width', 'height', 'position']) });
    }
  }
  return {
    tag: element.localName, selector: describeElement(element), role: element.getAttribute('role'),
    rect: measuredRect(element.getBoundingClientRect()),
    typography: readProperties(style, ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'font-style', 'color']),
    appearance: readProperties(style, ['background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style', 'opacity', 'box-shadow']),
    spacing: readProperties(style, ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left']),
    geometry: { ...readProperties(style, ['box-sizing', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius', 'transform']), 'css-width': style.width, 'css-height': style.height },
    layout: layoutProperties(style), parentLayout: parent ? layoutProperties(getComputedStyle(parent)) : {},
    pseudoElements, limitations, source: 'Exact (DOM)',
  };
}

/** Only open shadow roots are traversed. Cross-document frames deliberately remain opaque. */
export function deepestElementAt(x: number, y: number, root: Document | ShadowRoot = document): Element | null {
  let element = root.elementFromPoint(x, y);
  for (let depth = 0; depth < 20 && element?.shadowRoot; depth++) {
    const inner = element.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === element) break;
    element = inner;
  }
  return element;
}
