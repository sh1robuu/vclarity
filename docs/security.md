# Security and privacy

Vclarity separates local DOM inspection, local screenshot processing, and optional external AI analysis. The production extension connects to a local Node service at `http://127.0.0.1:4317`; only that service holds the provider API key.

## Data flow and consent

1. **Live Inspect:** An isolated-world script reads computed styling and rendered geometry for the selected element. It does not intentionally read form values, hidden input values, cookies, authentication headers or browser session tokens. The report includes a bounded element description and selector; no DOM tree or raw page HTML is sent to AI.
2. **Ghost Inspect:** The background worker captures the active tab's visible viewport after removing the selection overlay. A local image worker crops the selected region, extracts palette colors, and optimizes that crop. The full captured viewport is transient local processing input.
3. **Optional AI:** The panel presents the selected image's size and an external-processing disclosure. The user must check consent and click **Send image & analyze**. Exceeding the soft compression target requires an additional size acknowledgment. Selection and local processing alone do not send an image to the backend.
4. **Provider processing:** The panel sends the cropped, optimized image plus a request UUID to the local API with a separate local access token. The server sends that image to the configured Gemini, OpenAI or Ollama Cloud adapter with fixed analysis instructions and a structured output schema. It does not forward page URLs, extracted DOM properties or the local access token to the provider. Gemini requests use Google's native REST API at `generativelanguage.googleapis.com` with the server-side key in the `x-goog-api-key` header.

Visible screenshots can contain personal data, internal documents, rendered credentials or other sensitive information. Review the selected region before sending it. Provider-side handling is governed by the configured account and provider policies. Google states that free-tier content may be used to improve its products; see [Gemini pricing and data-use terms](https://ai.google.dev/gemini-api/docs/pricing). The implementation sets `store: false` on OpenAI requests, which is not a promise of zero provider retention. Gemini and Ollama do not inherit that OpenAI request setting.

## Credentials and local server

- `AI_API_KEY` belongs only in `apps/api/.env` or the server process environment. The Gemini adapter also accepts server-side `GEMINI_API_KEY`, and Ollama accepts `OLLAMA_API_KEY`. No provider key is needed for local inspection, and no provider key is included in extension source or client storage.
- `API_ACCESS_TOKEN` is a separate random token required to start the API. It must contain 32–512 characters. The panel sends it as a Bearer token. Saving it in Settings writes it to `chrome.storage.local` for future panel sessions; local storage access is restricted to trusted extension contexts, and the inspector does not need it. It is not the provider key. The saved token is ordinary local profile data, not an encrypted credential vault; clear it through Settings when no longer needed.
- `.env` files are excluded by `.gitignore`; `.env.example` contains no secrets. Do not commit an actual environment file or put it inside the unpacked-extension directory.
- The HTTP listener binds to `127.0.0.1`. It validates loopback Host names, permits browser origins only of the form `chrome-extension://<valid-id>`, and optionally restricts them to `API_EXTENSION_ID`. Non-browser requests without Origin still require the token for analysis.
- CORS is an additional browser boundary. It does not replace authentication. Both `POST /analyze` and `GET /connection` require the local token, compared through fixed-length digests and a timing-safe comparison. `GET /health` discloses only service health and whether a provider is configured.
- `GET /connection` returns only the provider name, bounded configured model name, provider-key configuration status and known image-support status. It never returns either credential, makes no provider request and does not use the analysis rate budget. Image support remains unknown unless the model is known to be unsupported; a successful local connection test is not a live credential, modality or quota verification.
- The local token protects the external-provider endpoint, including free-tier quota. Defaults permit 10 authenticated attempts per minute and two concurrent uploads/analyses across this process. Limits are process-local and reset on restart.

The shipped server is designed for a single-user loopback deployment. Public hosting would require a deployment-specific authentication, TLS, proxy and rate-limit design before use. Changing `API_PORT` alone does not change the panel endpoint or CSP.

## Storage and lifetime

| Data | Location and lifetime |
| --- | --- |
| Full viewport screenshot | Transient extension message and local image-worker input; not written to report storage. |
| Cropped image, optimized upload and preview | Panel/worker memory and a local Blob URL; discarded from application state on a new session, tab change, cancellation or panel teardown. Preview URLs are revoked and image workers terminated. |
| Local service token | Draft/panel memory and, after an explicit save, trusted-context `chrome.storage.local`. A saved token survives panel closure and browser restart until cleared through Settings, extension data removal or uninstall. |
| Provider API key | Server environment only. |
| Validated inspection report | Per-tab `chrome.storage.session`, so service-worker suspension can preserve lightweight results. Navigation and tab removal clear the relevant report; browser-session shutdown ends session storage. |
| Copied Markdown | Written only when a user activates a copy action. Further clipboard or destination-app retention is outside the extension. |

Reports can contain URL paths, element selectors, measured CSS and model-generated descriptions of visible content. Query strings, URL fragments and URL credentials are removed from report URLs, but a path or selector can still be sensitive. Closing the panel discards its image and in-memory token draft; it does not automatically delete every completed session report or an explicitly saved local token. No screenshots or credentials are added to report objects. Only the local service token can be saved by the extension; provider API keys remain server-side.

The application does not include analytics or a screenshot archive. Do not treat ordinary JavaScript memory cleanup as secure memory erasure.

## Validation and failure boundaries

Shared strict Zod schemas validate cross-context commands, report data, analysis requests and responses. The background accepts privileged panel commands only from this extension's side panel and content events only from its own top-frame script. Per-tab queues, inspection session UUIDs, request UUIDs and explicit state transitions prevent late results from replacing a newer inspection.

The capture path verifies the active tab and viewport before and after taking a screenshot. Pinch zoom, visual viewport panning, scrolling, navigation and unsupported pages lead to visible cancellation or error states. Local image processing runs in a dedicated worker with time and dimension limits.

The API checks streamed JSON bodies as well as declared Content-Length, bounds request bodies at 2.8 MB, and accepts only base64 JPEG/WebP images up to 2 MB. Image header type, actual header dimensions, client metadata, byte count, WebP container size and JPEG end marker must agree. Images are capped at 8192 pixels per dimension and 16,777,216 pixels. These are bounded structural checks, not a complete server-side image decode; the provider can still reject an unreadable image.

Provider fetches receive an AbortSignal, an overall deadline and a bounded response reader. A narrow provider JSON Schema preserves the shared contract's shape, required fields and enums while omitting size keywords that vary across supported models. Gemini requests JSON output with this schema; OpenAI uses Structured Outputs. Ollama Cloud receives the schema in its prompt because its cloud API does not enforce structured outputs. All adapters validate the result against the complete shared Zod schema, including all text and list bounds, before it reaches the panel. Incomplete responses, refusals, malformed JSON and schema mismatches produce explicit errors. Production code has no fabricated-success fallback.

Screenshots and website labels are untrusted model input. Fixed instructions tell the model to ignore embedded instructions, analyze interface evidence only, and distinguish observed from inferred claims. The provider receives no tools. This reduces prompt-injection exposure; it does not establish factual correctness. Model strings are rendered as React text, never executable HTML, and copy serializers escape Markdown structure.

The API returns deliberately written error messages and logs only allowlisted error codes and request UUIDs. It does not log screenshots, provider response bodies, authorization headers or arbitrary stack traces. AI failure leaves local DOM and palette results usable.

## Permission rationale

| Permission | Reason |
| --- | --- |
| `activeTab` | Temporary access to the tab after a user gesture, including permitted capture and injection. |
| `scripting` | Inject the small inspector only when requested. |
| `sidePanel` | Display the native Chrome Side Panel. |
| `storage` | Keep validated lightweight per-tab reports in `chrome.storage.session` and an explicitly saved local service token in trusted-context `chrome.storage.local`. |
| `clipboardWrite` | Support explicit Copy Note actions from the extension UI. |
| `http://127.0.0.1/*` host access | Reach the user's local AI backend. Chrome match patterns cover all ports on that host; CSP restricts extension requests to `http://127.0.0.1:4317`. |

There is no persistent all-sites host permission. Extension scripts and workers are bundled locally under the Manifest V3 CSP; remotely hosted executable JavaScript is not loaded. Inline styling is allowed for local UI values such as palette swatches, while scripts remain restricted to the extension itself.

## Verification scope

Automated API tests exercise validation, authentication, allowed origins, request limits, cancellation and real adapter request/response shapes through a mocked transport. They do not establish provider account access, free-tier availability or live model behavior. Consult the verification log for any live-provider checks actually performed.

See [the verification log](verification.md) for commands actually run, browser evidence and remaining checks, and [architecture](architecture.md) for context boundaries. Test artifacts use controlled fixture content; inspect artifacts before sharing any evidence captured from real websites.
