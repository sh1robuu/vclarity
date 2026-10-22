# Ollama Cloud

The backend supports `AI_PROVIDER=ollama`, an Ollama Cloud credential in server-side `AI_API_KEY` (or `OLLAMA_API_KEY`), and an exact `AI_MODEL` name from [the Cloud catalog](https://ollama.com/api/tags). Native requests use `https://ollama.com/api/chat`; API keys never enter extension bundles. Existing `AI_PROVIDER=openai` deployments remain supported.

The user's selected `gpt-oss:120b` is preserved. It accepts text, not images. Configuring this model does not make Ghost Inspect a functioning vision analysis: the backend returns an explicit `model_vision_unsupported` error before a screenshot reaches Ollama. Local inspection and palettes remain usable. An alternate vision model or a separately designed evidence pipeline requires an explicit model choice; there is no automatic replacement or fabricated fallback.

For a model advertising `vision`, the adapter verifies capabilities against the Cloud catalog before transmitting an image, uses the existing consent-controlled screenshot route, and validates the resulting analysis with the shared Zod schema. [Ollama Cloud currently does not enforce structured outputs](https://docs.ollama.com/capabilities/structured-outputs), so the JSON schema is provided in the prompt and invalid results fail explicitly. Model thinking is neither exposed nor logged.

The local `.env` is excluded from Git. A live paid inference request has not been made with the provided credential. Provider cost, account eligibility and any free credits must be checked before choosing a replacement model. The current provider options and pricing are separate from functional correctness.
