# Electron LLM provider settings

Settings > Models > LLM includes the existing provider catalogue. Translation
settings links to it. Configure an endpoint/model and, where needed, an API key
or account ID. Save preserves a stored key when the key input is blank. Keys
are sent only to the existing backend credential storage, never localStorage.
Environment-pinned fields and activation remain read-only with an explanation.

Save & use for translation explicitly activates the provider. Saving or testing
alone does not imply activation. Test and Fetch models first save the current
form, stop if saving fails, and then call the backend probe. They never run
on page load. Provider calls may use the network only when explicitly requested;
local endpoints remain supported. Failed probes use classified localized messages.

The browser smoke `node electron/tests/llm-providers-smoke.mjs` mocks credentials
and provider responses. It verifies blank-key preservation, environment pinning,
save-before-test, no probe after failed save, model choice and activation. A live
catalogue read returned 17 provider descriptors without key material. Actual
external credentials and remote-provider calls are not verified by those mocks.
Per-skill routing is available beneath providers. Each backend capability can be
disabled or assigned a configured provider, with an option to follow the active
provider. Existing unavailable overrides stay visible. Readiness comes from the
backend; it is not proof of a successful network probe. Non-LLM translation-provider
credentials for DeepL and Microsoft are available under Settings > Credentials and are
written through the backend environment-setting endpoint. The skills browser smoke
verifies routing and disable behavior against mocked API responses.

LM Studio discovery honors the selected model before probing loaded models. Its
native loaded-model probe uses the configured API key; embedding-only listings
are never selected for chat. Dictation refinement disables optional reasoning
where supported, retries only errors naming that parameter, and preserves literal
reasoning tags within an answer rather than truncating technical text.

In the supported web development client, API-reference recovery may use the
same-origin proxy only for its known local backend; remote overrides never fall
back to a different server. The configured authentication is retained.

LM Studio automatic discovery accepts only loaded `llm`/`vlm` entries from its native model metadata. If that metadata is unavailable, set a model explicitly in Settings; untyped OpenAI-compatible IDs are not used to guess whether a model supports chat. The authenticated native probe rejects redirects so credentials remain on the configured origin.
