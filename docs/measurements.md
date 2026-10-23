# Measurement semantics and limits

Vclarity attaches provenance to its output. **Exact (DOM)** identifies values read from the browser, **Measured (Pixels)** identifies local screenshot analysis, and **Estimated (AI)** identifies model interpretation. These sources answer different questions; a screenshot palette does not recover a site's original CSS tokens, and model inference does not verify product behavior.

## Live Inspect: browser values and geometry

Live Inspect reads `getComputedStyle(element)` and `getBoundingClientRect()` from the selected connected element. It does not retrieve original stylesheet declarations, source locations, design-system tokens, or the full cascade.

| Output | Meaning | Important limit |
| --- | --- | --- |
| Computed typography, spacing, appearance and layout | The browser's resolved CSS strings at inspection time | Authored `rem`, percentages, variables, shorthand and inheritance may already be resolved. Some properties retain keywords such as `normal` or `auto`. |
| CSS width and height | Resolved `width` and `height`, interpreted with the reported `box-sizing` | These values describe the CSS box and can differ from its rendered bounding rectangle. |
| Rendered width, height and viewport position | Axis-aligned rectangle returned by `getBoundingClientRect()` | Includes transforms and borders; it does not describe a rotated shape's individual edges or guarantee that every point inside the rectangle is painted. |
| Parent layout | Relevant computed layout properties of the parent, crossing an open shadow boundary to its host when necessary | This is contextual information, rather than a reconstruction of every layout constraint. |

CSS values remain browser-provided strings. Geometry retains fractional CSS pixels; neither the model nor an integer rounding step replaces the raw measurement. A user-facing value such as `120.5px` can therefore coexist with a transformed bounding width such as `144.60000610351562`. Margins, padding and computed dimensions are interpreted using the browser's box model, rather than inferred from screenshot distances.

Percentage widths and auto margins may be returned in resolved pixels. Inherited properties report the value resolved on the selected element. Vclarity cannot determine the original unit, variable name or declaration that produced these values. Computed `font-family` reports a font stack; it does not identify the exact font used for each rendered glyph, establish that a web font finished loading, or rule out font fallback.

Flex and Grid properties appear when the element's computed display mode makes them relevant. Positioned-element offsets and z-index are included for non-static positioning. Empty browser values become `null`; missing authored declarations are not invented.

## Special DOM cases

- **Transforms and fractional pixels:** geometry is a viewport-aligned rendered rectangle. The transform matrix and computed CSS dimensions remain separate values. A rotated or scaled element can have a bounding width that differs from its CSS width.
- **SVG:** selectable SVG elements have a rendered axis-aligned bounding rectangle. CSS box properties do not necessarily describe path geometry, viewBox coordinates, stroke extents or the shape's intrinsic dimensions.
- **Pseudo-elements:** when `::before` or `::after` has generated content, Vclarity records a small set of computed properties: display, color, background color, width, height and position. Pseudo-elements are not independently selected or assigned a measured DOM rectangle. Generated text is not collected by this path.
- **Shadow DOM:** hit testing descends into open shadow roots. Closed shadow-root internals are inaccessible; their host can be selected. This is not equivalent to full access to every component implementation.
- **Iframes:** the iframe element's own geometry and CSS can be inspected. Frame contents are deliberately opaque, including same-origin and cross-origin frames; no inspection script is injected into them.
- **Scrolling and rerendering:** measurements are a snapshot. Detached or zero-size selected elements produce an explicit error. The selection workflow cancels when it observes scrolling, resizing or loss of focus. It does not freeze a website's animations, lazy loading or asynchronous rendering.

The DOM extraction path reads style, geometry and limited semantic metadata. It does not collect password values, other form-field values, cookies, storage tokens, or hidden input values. A selected screenshot can still contain visible private information.

## Ghost Inspect: capture and coordinates

The privileged background uses `chrome.tabs.captureVisibleTab()` to capture the browser-rendered viewport. Selection overlays are removed before the request, with two animation frames allowed for rendering to update. Tab, inspection session and viewport checks guard the capture workflow. A screenshot represents one moment of a dynamic page, rather than a transaction that freezes its content.

Regions use viewport-relative CSS coordinates. Document scroll offsets are recorded to detect movement; they are not added to the crop position. The crop mapper derives scale from the **actual captured bitmap width and height divided by the recorded CSS viewport dimensions**. It does not assume one CSS pixel equals one image pixel, or multiply an assumed device pixel ratio onto an already scaled screenshot.

This mapping accommodates ordinary browser page zoom and device pixel ratio differences when the capture and viewport remain consistent. A materially inconsistent horizontal/vertical bitmap scale is rejected. Current capture validation rejects pinch zoom and nonzero visual viewport panning offsets with a reset-zoom instruction. Those combinations are unsupported, rather than approximately cropped.

Crop edges are clamped to the bitmap and rounded outward: start coordinates use `floor`, end coordinates use `ceil`. This preserves the final image row or column at fractional CSS boundaries. Original image dimensions in the optimization metadata are **cropped bitmap pixels**, which can differ from the region's CSS-pixel dimensions. Selections must be at least 8 × 8 CSS pixels; invalid or empty crops are rejected. Processing also limits a crop to 8192 pixels per dimension and 32 million pixels total.

## Local dominant colors

Palette extraction uses no AI or network request. A dedicated worker decodes the capture, crops it, and reads a bounded nearest-neighbor sample of at most 12,000 pixels. Sampling the entire region keeps work bounded while avoiding the bias of reading only the first rows. Very thin strokes, tiny accents and periodic textures can still be missed or aliased.

Pixels are composited over white, grouped into a 5-bit-per-channel RGB histogram, then clustered using a weighted OKLab distance approximation. Up to 12 working clusters and seven refinement iterations preserve both broad surfaces and smaller distinct accents. Perceptually close clusters are merged; the five largest remaining groups are returned. Uniform or nearly uniform images can correctly produce fewer than five colors.

Each displayed HEX/RGB value is a representative weighted mean for a cluster. It may differ from any particular source pixel. Coverage is the group's approximate share of sampled pixels, rounded to one decimal place. Groups are ranked by coverage. When other groups are omitted from the top five, the displayed percentages can total **less than 100%**; they are not redistributed to manufacture complete coverage. Rounding can also produce a small difference from 100%.

Photographs, illustrations, gradients, antialiasing, shadows, opacity and compositing all influence the result. A rendered translucent surface is represented by its visible blend; screenshot capture cannot recover its original foreground color or alpha. Dominant colors should therefore be read as **Measured (Pixels)**, not as original stylesheet declarations or certified design tokens.

## Optimized images and readability

The worker re-encodes the cropped canvas, omitting the original file metadata. WebP is preferred; JPEG is a fallback when needed. It tries quality levels 0.90, 0.82 and 0.74 before progressively reducing dimensions. The size target is strictly below **100,000 encoded bytes**, excluding base64/JSON transport overhead.

The resolution floor keeps at least 75% of the original cropped bitmap dimensions and avoids reducing the long edge below 1024 pixels. Smaller originals are not enlarged or downscaled. Encoded images also stay within the API's shared 16,777,216-pixel limit, even when a large, low-detail image already meets the byte-size target. If fitting that limit would violate the resolution floor, local processing asks for a smaller region before upload. Quality never falls below 0.74. These controls are conservative heuristics, not an automated proof that every small label remains legible.

If those limits cannot achieve the target, the smallest usable encoding is returned with `targetMet: false` and a warning. An encoding above 2,000,000 bytes is rejected with instructions to select a smaller area. Dense screenshots and photographs may exceed the target. Reviewing the in-memory preview and choosing a smaller, focused region is preferable to automatically discarding text detail.

Original crop dimensions, encoded dimensions, format, byte size and target status accompany the image. The preview shows the optimized image that can be sent to AI. Captured screenshots and previews are held in panel/worker memory and are not persisted by default. AI transmission requires the user's explicit action; local DOM and palette analysis work without provider credentials.
