# Vclarity

A Chrome Manifest V3 extension for inspecting interfaces in Chrome's native Side Panel. Live Inspect reads browser-computed CSS and rendered geometry. Ghost Inspect crops a selected screen region, extracts dominant colors locally, and offers optional UX and product analysis through a local Vision API backend.

The source includes the extension, shared runtime schemas, Gemini, OpenAI and Ollama Cloud adapters, automated tests, a controlled browser fixture, Markdown report exports, and a palette benchmark. Current check results and remaining verification work are recorded in [the verification log](docs/verification.md). See [architecture](docs/architecture.md) and [security and privacy](docs/security.md) for implementation details.

## Requirements

- Node.js **22.12 or newer**.
- pnpm **11 or newer**; the repository pins pnpm 11.25.0 in `package.json`.
- Chrome **116 or newer** for the native Side Panel.
- A provider API account and a compatible vision model only if you want external AI analysis. The example configuration uses Gemini `gemini-3.5-flash-lite`; OpenAI and native Ollama Cloud are also supported. Local DOM inspection and pixel analysis work without a provider key or running API service.

Run all commands below from the repository root. PowerShell examples are provided for Windows.

```powershell
node --version
pnpm --version
pnpm install
```

If pnpm is not installed, install the pinned version with `npm install --global pnpm@11.25.0`, then run `pnpm install`.

## Build and load the extension

```powershell
pnpm build
```

This produces the Chrome extension in `apps/extension/.output/chrome-mv3` and the bundled Node API in `apps/api/dist/index.js`.

The handoff also includes [a packaged extension ZIP](releases/vclarity-0.1.1-chrome.zip). Extract it into a folder before choosing **Load unpacked**. The ZIP contains the built extension only; source and the optional API service are in this repository. The 0.1.1 audit and fixes are recorded in [the product audit](docs/product-audit-2026-10-23.md).

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select `apps/extension/.output/chrome-mv3` inside this repository.
4. Open an ordinary HTTP(S) website and click the Vclarity toolbar icon. This opens the native Side Panel and grants temporary `activeTab` access to that website. Pin the extension through Chrome's extensions menu if needed.
5. Choose **Live Inspect** or **Ghost Inspect** in the panel. Press Escape on the website, or use the panel's Cancel control, to stop a selection.

After rebuilding, click **Reload** for Vclarity at `chrome://extensions`, then reopen the panel. Reload the website if an earlier injected script is still present.

Live Inspect highlights the hovered element and measures it when selected. The selection click is intercepted to avoid activating the website control. Ghost Inspect supports dragging in any direction, removes the overlay before capture, processes the crop in a worker, and displays a local palette. Open **Product & UX Insights** to review the optional AI disclosure and consent controls.

Suggested shortcuts are **Alt+I** for Live Inspect and **Alt+S** for Ghost Inspect. Chrome, the operating system, or another extension may reserve them. The panel displays Chrome's current assignments, and its mode buttons remain available. Change assignments at `chrome://extensions/shortcuts` or through **Settings → Customize Chrome shortcuts**. Toolbar access may need to be granted again after navigation.

## Optional AI backend

Copy the server environment template:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
```

Generate a random local access token:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Edit `apps/api/.env` and set:

| Variable | Purpose |
| --- | --- |
| `AI_PROVIDER` | `gemini`, `openai` or `ollama`. The template uses `gemini`. |
| `AI_API_KEY` | Your provider API key. Keep it only on the server. `GEMINI_API_KEY` is also accepted for Gemini; `OLLAMA_API_KEY` for Ollama. `AI_API_KEY` takes precedence when supplied. |
| `AI_MODEL` | An exact vision model name available to your account. The template uses `gemini-3.5-flash-lite`. |
| `API_ACCESS_TOKEN` | The generated local token; 32–512 characters required. This is separate from the provider key. |
| `API_PORT` | Keep `4317` for the supplied extension. |
| `API_EXTENSION_ID` | Optional: your 32-character extension ID from `chrome://extensions`, to restrict allowed browser origins further. |
| `AI_TIMEOUT_MS` | Overall analysis deadline; default `45000`. |
| `API_RATE_LIMIT_PER_MINUTE` | Authenticated request budget shared by this local service; default `10`. |
| `API_MAX_CONCURRENT` | Maximum concurrent uploads/analyses; default `2`. |

Start the backend in a separate terminal:

```powershell
pnpm dev:api
```

Check its health:

```powershell
Invoke-RestMethod http://127.0.0.1:4317/health
```

The response reports `status: ok` and whether AI is configured. A missing provider key leaves `aiConfigured` false and AI requests return a configuration error; a valid local access token is still required to start the service.

For Gemini, `pnpm --filter @vclarity/api check:gemini` checks the configured key and exact model against Google's model metadata endpoint without uploading an image or running inference. Metadata access does not establish available generation quota.

In the extension, open **Settings**, enter the same `API_ACCESS_TOKEN`, and press Enter or choose **Save connection** to keep it for later panel sessions. Never paste `AI_API_KEY` into the extension. The saved local token is stored in `chrome.storage.local`, restricted to trusted extension contexts. This is ordinary local extension storage, not an encrypted credential vault. Use **Forget saved token** to remove it, or turn off **Remember this local service token on this device** before saving for panel-only use. Saving works while the backend is offline and explains how to reconnect.

Use **Test connection** to check the local token and view the server's configured provider, model and whether a provider key is set. This calls authenticated `GET /connection`; it sends no screenshot, performs no inference and does not consume the analysis request budget. Unknown image support is shown as unverified, while known text-only Ollama GPT-OSS configurations are rejected for image analysis. A successful connection check does not verify external provider credentials, model access or quota.

Capture a region, inspect its preview and size, then open **Product & UX Insights**. Check the consent box and click **Send image & analyze**. Images that exceed the 100 KB compression target require an additional size acknowledgment. Only the cropped, optimized image and a request ID are sent to the local service; the service then sends the image to the configured provider. Provider results are validated before display. Failed AI analysis can be retried while the capture remains in panel memory.

See [Gemini setup](docs/gemini.md) for the recommended configuration, image handling and free-tier limits. Google lists a free tier for `gemini-3.5-flash-lite`, subject to account eligibility and quota. Google also states that free-tier content may be used to improve its products; review the selected screenshot before sending it. [Gemini pricing and data-use table](https://ai.google.dev/gemini-api/docs/pricing).

Existing OpenAI configurations remain supported through its [image input](https://developers.openai.com/api/docs/guides/images-vision) and [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) APIs. When `AI_PROVIDER` is omitted, the backend retains `openai` as its compatibility default. Consult [the verification log](docs/verification.md) for actual live-provider checks; a healthy local server alone does not establish that credentials, a model or account quota are usable.

Native Ollama Cloud is also supported; see [Ollama setup and modality limits](docs/ollama-cloud.md). The requested `gpt-oss:120b` is text-only, so it cannot independently power screenshot analysis. Its image requests are rejected explicitly before external transmission.

The panel endpoint and extension Content Security Policy are fixed to **`http://127.0.0.1:4317`**. Changing only `API_PORT` will disconnect the panel. To use another port, update the panel client and CSP together and rebuild. The API binds to IPv4 loopback and is intended for local use. The compiled backend can be started with:

```powershell
pnpm --filter @vclarity/api start
```

## Development and checks

```powershell
pnpm dev          # WXT extension development workflow
pnpm dev:api      # API development server; separate terminal
pnpm typecheck   # Shared, extension, and API TypeScript checks
pnpm lint
pnpm test        # Unit and integration tests; provider transport is mocked
pnpm build       # Production extension and API builds
pnpm benchmark   # Palette computation timing on deterministic pixel fixtures
```

Follow WXT's terminal instructions for its development browser/profile. Use the production build and unpacked-install steps above when checking the production artifact. The benchmark excludes screenshot capture, decoding, image readback, compression, and network time; its results describe the host where it runs.

Browser tests require the production extension build and a Playwright Chromium installation:

```powershell
pnpm exec playwright install chromium
pnpm build
pnpm test:browser
```

On Windows, the standard Playwright cache is `%LOCALAPPDATA%\ms-playwright`. The test launcher also checks a repository-local `.playwright` cache. To select a particular compatible Chromium executable:

```powershell
$env:VCLARITY_CHROMIUM_PATH = 'C:\path\to\chromium\chrome.exe'
pnpm test:browser
Remove-Item Env:VCLARITY_CHROMIUM_PATH
```

The suite starts its fixture server at `127.0.0.1:4173` and loads the built MV3 extension in a persistent Chromium context. It saves browser evidence under `test-results` and an HTML report under `playwright-report`. These commands are instructions, not a claim that every browser check has passed; consult [the verification log](docs/verification.md) for actual results and coverage.

## Sources and data labels

| Label | Meaning |
| --- | --- |
| **Exact (DOM)** | Browser-computed CSS and rendered element geometry. Original stylesheet declarations and the font used for each glyph are not established. |
| **Measured (Pixels)** | Local dominant screenshot colors and approximate area coverage. Photographs, gradients and antialiasing influence the palette. |
| **Estimated (AI)** | Screenshot interpretation, with observed/inferred classifications, evidence, confidence, unknowns and validation questions. |

Copy actions export palette, design specs, UX analysis, product logic or the full report as Markdown from validated state. Copying does not trigger another AI request. Source and confidence labels remain in the exported notes.

## Project layout

```text
apps/extension/entrypoints/  MV3 background worker, inspector and native side panel
apps/extension/components/  React inspection controls, specs and insights
apps/extension/lib/         DOM inspection, capture coordination, image workers and exports
apps/extension/stores/      Panel state and stale-session checks
apps/api/src/               Authenticated Hono routes, image validation and Vision adapter
apps/api/tests/             API, provider transport and validation tests
packages/shared/           Zod schemas, message contracts and workflow transitions
tests/browser/             Production-extension browser tests
tests/fixture-server.mjs    Controlled inspection fixture server
tests/palette.bench.ts      Reproducible palette computation benchmark
docs/                      Architecture, security and verification records
```

## Limits and troubleshooting

- Chrome internal pages, the Chrome Web Store, and non-HTTP(S) pages cannot be inspected. Click the toolbar on a supported website to grant access when injection or screenshot permission is missing.
- Inspection runs in the top document and traverses open Shadow DOM. Closed shadow roots and iframe internals are unavailable; iframe elements themselves can be measured.
- Browser page zoom is accounted for through bitmap-to-viewport ratios. Pinch zoom and visual viewport panning are rejected explicitly. Moving the viewport or scrolling during capture requires a new selection.
- Local crops are limited to 8192 pixels per dimension and 32 million pixels. AI uploads are limited to 2 MB, 8192 pixels per dimension and 16,777,216 pixels. A larger region can remain usable for local analysis while requiring a smaller selection for AI.
- Optimization targets less than 100,000 bytes while preserving readable detail. It can exceed that target with a visible warning and explicit acknowledgment, or reject a region that cannot fit the hard upload limit.
- Screenshots and previews are temporary panel state. New inspections, tab changes, cancellation or panel closure discard the current capture. Restoring a lightweight report after worker suspension does not restore its screenshot; capture again when necessary. The saved local service token remains in extension local storage until explicitly cleared or the extension's stored data is removed.
- Reports stay in `chrome.storage.session` during the browser session and may contain page paths, measured selectors, and analysis text. Screenshots and credentials are excluded. Navigation or tab removal clears that tab's report. See [security and privacy](docs/security.md).
- If AI cannot connect, start the service on `127.0.0.1:4317`. For authentication errors, compare the panel token with server `API_ACCESS_TOKEN`. For provider authentication, model access, timeout or quota errors, follow the backend message and check the server configuration. Local inspection remains available.
- Screenshot analysis cannot verify hidden states, interaction behavior, internal business rules, authored CSS, or accessibility conformance. Validate inferred behavior independently.

## Permissions

Vclarity requests `activeTab` for temporary user-granted access, `scripting` for on-demand inspector injection, `sidePanel` for its native UI, `storage` for lightweight session reports and the saved local service token, and `clipboardWrite` for user-triggered Copy Note actions from the extension. Its only persistent host permission is `http://127.0.0.1/*` for the local API. Chrome host match patterns cover all ports for that host; the extension's `connect-src` CSP narrows requests to port 4317. It does not request persistent access to arbitrary websites.
