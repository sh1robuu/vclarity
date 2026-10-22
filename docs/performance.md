# Palette performance and measurement scope

The palette computation target is under 50 ms for typical selected regions on reference hardware. The measurements below test the palette function with synthetic pixel buffers. They do not establish end-to-end capture latency, browser interaction responsiveness or performance on every machine.

## Recorded benchmark

Measured on 22 October 2026 using:

| Item | Environment |
| --- | --- |
| Operating system / architecture | Windows (`win32`), x64 |
| CPU reported by Node | 12th Gen Intel(R) Core(TM) i5-12500H |
| Runtime | Node.js v24.19.0 |
| Sample budget | At most 12,000 pixels per image |
| Warmup | 8 untimed extractions per fixture |
| Timed iterations | 40 extractions per fixture |
| Timing | `performance.now()` around `extractPalette()` |

| Fixture | Input dimensions | Median | p95 | p95 below 50 ms |
| --- | --- | ---: | ---: | --- |
| Small | 320 × 200 | 1.12 ms | 2.52 ms | Yes |
| Medium | 1280 × 800 | 0.74 ms | 0.97 ms | Yes |
| Large | 3840 × 2160 | 0.79 ms | 1.08 ms | Yes |

These values are one recorded run, rather than a guaranteed latency budget. Large inputs do not necessarily take longer because all fixtures use a bounded sample; their sampled color distributions and resulting number of occupied histogram bins differ. Runtime warmup, garbage collection and host activity can also affect results. The benchmark reports sorted-run median and nearest-rank p95; it does not remove outliers.

The deterministic fixture mixes broad pale UI surfaces, text-like dark stripes, a saturated gradient and photograph-like noise. Buffer allocation and fixture generation happen outside timed sections. No actual website screenshot or private image content is used.

Included in the timed computation:

- Choosing stratified sample positions from the provided RGBA buffer.
- Alpha compositing over white and populating the quantized histogram.
- Converting occupied buckets to OKLab, weighted clustering and close-color merging.
- Ranking the five largest groups and formatting HEX/RGB/coverage output.

Excluded from the timing:

- Screen-region selection, overlay removal and browser screenshot capture.
- Base64 decoding, ImageBitmap decoding and canvas crop operations.
- Canvas sampling, `getImageData()` readback and worker startup/message transfer.
- Image compression, resize attempts and preview generation.
- AI requests, network latency and React rendering.

In the extension, `computationMs` similarly surrounds palette extraction after worker canvas readback. It is not a progress percentage or the total duration shown by the capture workflow. Worker palette input has already been reduced to the sample budget; the command-line benchmark passes full-size synthetic buffers to exercise the sampling function too.

## Reproduce

From the repository root, after installing the workspace dependencies:

```powershell
pnpm benchmark
```

The final recorded run used `pnpm benchmark`. The underlying entry point can also be invoked directly:

```powershell
node node_modules/tsx/dist/cli.mjs tests/palette.bench.ts
```

Both run the same checked-in `tests/palette.bench.ts` script. Run the benchmark on the intended deployment hardware and retain its environment header when comparing results. Node and Chrome have different execution environments; a Node benchmark alone does not verify Chrome worker timing.

Image unit checks can be run with:

```powershell
pnpm exec vitest run apps/extension/lib/image
```

The implemented suites cover crop mapping, sample bounds, OKLab and alpha conversion, cluster/frequency behavior, compression policy and format fallback, capture decoding, worker cancellation, timeout and memory cleanup. Unit tests are separate from timing measurements; they should not enforce a wall-clock speed threshold that varies with shared CI load.

## Responsiveness and bounded work

Decoding, cropping, palette computation, resizing and encoding run in a dedicated worker. Cancelling a capture terminates that worker; panel teardown disposes pending jobs and preview object URLs. This architecture keeps these CPU-heavy tasks off the panel's UI thread, but the measurements above do not certify perceived responsiveness in a browser.

Sampling is capped independently of screenshot size. Crops are also bounded to 8192 pixels on either side and 32 million pixels in total. Encoding tries a finite series of quality/resolution candidates, preserves the documented readability floor, and can return an above-target warning or a controlled smaller-region error. Difficult images can therefore take longer to encode even when palette computation remains fast.

The current automated worker timeout is 30 seconds for the complete local pipeline. This is a recovery limit, not an expected completion time. The screenshot API has a separate browser capture-rate limit; capture scheduling and AI latency are outside this palette benchmark.

## Verification status

The recorded timing is from the Node benchmark above. Image unit tests, static type checking and lint checks were executed during implementation. Browser pipeline coverage is recorded separately in [verification](verification.md).
