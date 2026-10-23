# Verification record

## 23 October 2026: product audit and 0.1.1 fixes

The current source passed `pnpm typecheck`, `pnpm lint`, `pnpm test` (228 tests in 17 suites), `pnpm build` and `pnpm test:browser` (4 scenarios). The new browser regression checks the distinct Insights starter, Enter-to-save, visible save/connection feedback, storage surviving panel-page closure/reopen, Forget, and opt-out from persistence. Existing DOM, pixel/capture, consent, retry and clipboard scenarios still pass. Provider calls in browser tests remain explicitly mocked.

The running bundled backend also returned `/health` HTTP 200, unauthenticated `/connection` HTTP 401 and authenticated `/connection` HTTP 200 with Gemini configuration metadata and `Cache-Control: no-store`. This check used the existing local credential without logging it; no new provider inference was performed. The previously recorded live Gemini fixture request remains the live Vision evidence.

Additional regressions cover trusted-context local-token storage, offline saving, rejected provider-key input, storage failure, malformed saved data, stale checks after Forget, unrelated-tab broadcasts during initial context restoration, authenticated metadata routing, and one shared encoded-image pixel limit. The panel deadline now leaves room above the backend's supported 120-second maximum. See the [Vietnamese product audit](product-audit-2026-10-23.md) for feature status, fixes and release priorities.

Reviewed current 300 px screenshots: [Insights starter](screenshots/insights-starter-0.1.1.png) and [saved connection](screenshots/connection-saved-0.1.1.png). Screenshots use fixture configuration, contain no real credentials, and render the actual extension page; the native docking and remaining manual checks below still apply.

Release `vclarity-0.1.1-chrome.zip` contains 12 files, is 160,275 bytes, and has SHA-256 `60f6df0b95cb2cbc256088e02da74f96f550e6ce3bb237d1568dd4eea4f97bf5`. Each archived file and the extracted release folder match the browser-tested production build byte for byte; its manifest reports 0.1.1. A scan of the 12 built files against the configured provider key and local access token found neither secret in the output. Checksums are retained in `releases/SHA256SUMS.txt`.

## Earlier implementation evidence

Executed on 22 October 2026 on Windows x64, Intel Core i5-12500H, Node v24.19.0, pnpm 11.25.0, WXT 0.21.4 and Playwright 1.64.1. Browser execution used an isolated Chromium 156.0.8078.4 profile with the production unpacked MV3 build. It did not use the user's normal browser profile or private website content.

| Check | Recorded result |
| --- | --- |
| `pnpm typecheck` | Pass: strict shared, API, extension and test/tool TypeScript |
| `pnpm lint` | Pass |
| `pnpm test` | 201 tests pass in 16 suites, including Gemini and Ollama follow-ups |
| `pnpm build` | Pass: production Chrome MV3 bundle and Node API bundle |
| `pnpm test:browser` | 3 scenarios pass against the production extension |
| `pnpm benchmark` | Palette p95 2.52 / 0.97 / 1.08 ms for small / medium / large synthetic fixtures |
| Actual bundled API process | Started on loopback; `/health` returned `aiConfigured:false`; authenticated `/analyze` returned the documented 503 provider-configuration error |

## Browser evidence

The three scenarios contain multiple assertions and exercise:

- Actual extension installation and background/content/panel communication, with mode activation through the UI controls.
- Computed 16 px typography, 600 weight, 12 px padding, 8 px radius, 160 × 48 rendered button geometry and the known blue background against a controlled fixture.
- Open Shadow DOM selection, separate transformed bounds and CSS width, iframe boundary disclosure, repeat inspection, Escape cancellation and overlay removal.
- Prevention of the website's selection click, followed by a normal website click after inspection ends.
- Toolbar invocation using Chrome's `Extensions.triggerAction` testing protocol, native side-panel target opening/closing and temporary screenshot permission. No permanent arbitrary-site permission was added for tests.
- Real `captureVisibleTab` output, reverse drag selection, crop dimensions derived from the actual screenshot bitmap/viewport ratio, worker decoding, OffscreenCanvas encoding, five known equal-coverage palette colors and absence of selection-overlay colors.
- Viewports 1280 × 1100 and 1050 × 1100 with emulated device scale factors 1 and 2. Chrome's captured bitmap scale is read independently of emulated DPR.
- Local results while the AI service is absent, no automatic AI submission, explicit consent controls, a mocked provider failure, retry of the same image with a new request ID, validated UX/product output and observed/inferred/unknown presentation.
- Real clipboard success feedback for full-report and palette copy, capture deletion after navigation, no screenshots in session report storage, keyboard source-tooltip behavior and settings input focus.
- Rendered sidebar layout at 300, 360 and 380 CSS px without horizontal overflow.

For automation, screenshots render the extension's actual `sidepanel.html` entrypoint in an extension tab. The native side-panel host is separately opened and closed through the toolbar path; desktop docking/chrome appearance is a manual check. The inspected page uses only deterministic test data. The insights screenshot uses the explicitly mocked provider fixture from the browser test, never a production fallback.

Reviewed images: [Live Inspect](screenshots/live.png), [Ghost Inspect](screenshots/ghost.png), [AI disclosure](screenshots/consent.png), [validated mock insights](screenshots/insights.png), [300 px settings](screenshots/settings.png).

The preinstalled system test Chromium initially failed with a Windows side-by-side configuration error. A fresh browser was installed under the repository-local ignored `.playwright` cache, and the final scenarios ran successfully with that binary. Native bundler/test execution required escaping the environment's Windows ancestor-directory traversal restriction; no checks were reported as passing before they executed successfully.

## Unit and integration coverage

Tests cover CSS-value preservation, rendered bounds, four drag directions, viewport stability, bitmap crop mapping, sampling and alpha conversion, perceptual palette clustering and frequency, compression format/size/readability policy, worker abort/timeout/disposal, bounded data URL decoding, Markdown provenance, schema strictness, workflow transitions and stale session/request IDs.

Background and panel integration tests cover injection failure, report isolation, capture errors, screenshot delivery, invalid transitions, late AI results, rapid double-click submission, per-window broadcast isolation, worker-port reconnection and image retention after AI errors. Backend tests exercise authentication, CORS/Host restrictions, body and image validation, rate/concurrency limits, deadlines/cancellation, real adapter request structure and provider normalization/error responses using mocked transport.

## Remaining manual checks and product limits

- **Provider coverage:** a live Gemini request is verified below. OpenAI and Ollama transport remain covered by mocks; no live inference was made against those providers. Model access and quotas depend on the configured account.
- **Physical shortcuts:** Alt+I and Alt+S are declared and Chrome's current assignments are displayed. Headless CDP key injection did not dispatch OS/browser shortcuts. Test physical bindings on the target desktop and customize conflicts at `chrome://extensions/shortcuts`. The sidebar buttons are browser-tested alternatives.
- **Chrome 116 baseline:** the manifest and runtime APIs target 116+, but execution here used Chromium 156. The older baseline and other operating systems still need manual release validation. Test-only CDP APIs are never bundled into the extension.
- **Native host presentation:** visually review real docked-panel resizing and toolbar behavior in desktop Chrome. The actual extension page was visually reviewed; native host docking is outside the screenshot harness.
- **Real-world page coverage:** broader React/Vue apps, nested scrolling during capture, browser page zoom settings, and long-idle worker suspension should receive a manual smoke pass. Their guards and unit coverage do not replace full cross-site testing.
- **Deliberate scope limits:** iframe internals, closed Shadow DOM, browser-restricted pages, non-HTTP(S) pages and pinch zoom/panning are unavailable. DOM context is omitted from AI uploads. Screenshots cannot establish hidden business rules or accessibility conformance. Reports retain only browser-session data; images require recapture after disposal.

See [measurement semantics](measurements.md), [performance](performance.md) and [security](security.md) for bounds and tradeoffs. This is a tested production-oriented source/build handoff, not a Chrome Web Store publication or a claim of completed cross-platform release certification.

## Ollama Cloud follow-up

Added native Ollama Cloud transport and exact model selection. The follow-up API run passed 95 tests in four suites, including 34 Ollama tests and a route test proving that `gpt-oss:120b` screenshot requests fail before external transmission. API TypeScript and lint checks pass. Credential configuration is server-side and ignored by Git. No live paid inference request was made; selection of a vision-capable provider/model is still required for this configuration.

## Gemini follow-up

Configured `AI_PROVIDER=gemini` and exact model `gemini-3.5-flash-lite` using the supplied credential in the ignored server environment. An authenticated Google model-metadata request returned HTTP 200. A real Vision request then exercised the local authenticated analysis route, JPEG validation, native Gemini transport and full shared response validation using only a locally generated fixture interface.

The successful live test submitted a 900 × 194 JPEG of 14,661 bytes and returned HTTP 200 with two UX insights, seven observed elements and one limitation. The request ID and complete response passed the shared Zod schema. An earlier inference attempt failed transiently; one explicit diagnostic retry succeeded. No automatic provider/model fallback was used. No personal website screenshots were uploaded.

The final regression run passed 201 tests in 16 suites; all strict TypeScript checks and repository lint passed. The Gemini adapter contributes 41 mocked transport/normalization/error tests, alongside a route-level provider-selection test. The metadata and live Vision checks are explicit scripts rather than automatic paid CI tests. Extension code and its prior browser coverage remain unchanged by this backend integration.
