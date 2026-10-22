# Gemini

The backend supports Google's native Gemini REST API with `AI_PROVIDER=gemini`. The example configuration selects [`gemini-3.5-flash-lite`](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), which accepts image input and supports structured JSON output. A single request analyzes the selected screenshot and returns Vclarity's UX and product analysis; no second language model is required.

## Configure the local backend

From the repository root, copy `apps/api/.env.example` to `apps/api/.env` if you have not created a local environment file. Set these values in that file:

```dotenv
AI_PROVIDER=gemini
AI_API_KEY=your-google-ai-studio-key
AI_MODEL=gemini-3.5-flash-lite
API_PORT=4317
API_ACCESS_TOKEN=your-separate-random-local-token-at-least-32-characters
```

Create a provider key in [Google AI Studio](https://aistudio.google.com/apikey). `GEMINI_API_KEY` is accepted as an alias when `AI_API_KEY` is empty. A nonempty `AI_API_KEY` takes precedence, so remove an old provider's value when switching providers. Generate `API_ACCESS_TOKEN` with the command in the [README](../README.md); it is a separate local secret, not the Google key.

Restart the service with `pnpm dev:api`. `GET http://127.0.0.1:4317/health` reports whether a provider key is configured; it does not test that key against Google or confirm account quota. In the extension's **Settings**, enter only `API_ACCESS_TOKEN`. Provider credentials stay in the server environment and are never bundled into the extension.

To verify the configured credential and exact model with Google's model metadata endpoint, run:

```powershell
pnpm --filter @vclarity/api check:gemini
```

This authenticated check does not upload an image or run inference. Success confirms access to model metadata; it does not establish that generation quota is available. Actual checks performed for this handoff are recorded in the [verification log](verification.md).

For an explicit live test with a JPEG or WebP file, run:

```powershell
pnpm --filter @vclarity/api check:vision C:\path\to\test-image.jpg
```

This command sends the named image to the configured provider and consumes its quota. It validates the complete analysis route and response, printing only safe status/count metadata. It never prints the provider key or the image payload. The completed handoff has a successful live Gemini test against a controlled fixture; see the verification record for its dimensions and result.

Capture a region with **Ghost Inspect**, review its preview and size, then open **Product & UX Insights**. Check consent and click **Send image & analyze**. A new explicit submission is required for each image analysis. The extension continues to use only `http://127.0.0.1:4317`; the local backend makes the external Gemini request.

## Request and result handling

The adapter calls the fixed host `generativelanguage.googleapis.com` and passes the API key in the `x-goog-api-key` header. It sends only the cropped, optimized JPEG or WebP image and fixed analysis instructions. It does not send the original page URL, DOM tree, local access token or full viewport capture.

Requests ask for JSON output matching the shared analysis shape. The returned JSON must also pass Vclarity's complete local Zod validation before it can appear in the panel. Invalid output, safety refusals, incomplete generation, authentication errors, quota limits and timeouts produce explicit failures. Local DOM inspection and palette analysis remain available if Gemini fails. The application does not automatically switch to another provider or model.

## Free tier and screenshot privacy

Google lists free-tier pricing for this model, with account eligibility, quotas and availability governed by Google. Free tier is not a guarantee that every project or request has available quota. Check the current [Gemini pricing table](https://ai.google.dev/gemini-api/docs/pricing) and your account's limits; Vclarity does not enable billing or purchase credits.

Google states that free-tier content may be used to improve its products. Review the selected screenshot for private or confidential information before granting consent. Provider retention and data-use terms come from your Google account and service tier; local image cleanup does not control provider-side handling. See [security and privacy](security.md) for the complete local data lifecycle.

## Other providers and verification

Existing `AI_PROVIDER=openai` configurations remain supported. Omitting `AI_PROVIDER` retains the OpenAI compatibility default; the example environment explicitly selects Gemini. [Ollama Cloud](ollama-cloud.md) also remains supported, but `gpt-oss:120b` accepts text only and cannot analyze screenshot inputs. Selecting Gemini does not send images to that model.

See [the verification log](verification.md) for actual test results and live-provider checks. Mocked adapter tests and a successful local health response do not establish that a supplied provider key works.
