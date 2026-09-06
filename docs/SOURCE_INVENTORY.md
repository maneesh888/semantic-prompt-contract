# Source inventory and migration record

This inventory was captured from OpenKeyboard `5908188bbb72f6a1f7838035fd96829843b74143` and LLM Gateway `8671339b6476acf90af8045754481f9a4cffbe39` before migration.

## Discovered contract packs and consumers

### Writing actions

Canonical behavior was duplicated in:

- `OpenKeyboardCore/Sources/OpenKeyboardCore/WritingAction.swift`, where `WritingPromptBuilder` rendered `continue_writing`, a core-specific `rewrite`, `fix_grammar`, `summarize`, and parameterized `translate` prompts.
- `OpenKeyboard/Models/KeyboardSuggestionModels.swift`, where `KeyboardGatewayActionContract` rendered the production app/extension versions of those operations plus `improve` and arbitrary rewrite instructions.
- `OpenKeyboardExtension/KeyboardAIService.swift`, where 15 rewrite-style instructions and translation target prompt names were selected before calling the production contract renderer.
- `OpenKeyboard/Services/NetworkManager.swift` and `OpenKeyboard/Views/LiveAITestHarnessView.swift`, which used the same production contract for live diagnostics.

The request path sends ordered `system` and `user` messages, `operation`, `input_text`, optional `response_format`, `temperature`, `max_tokens`, and `stream: false` through the configured gateway. Starting in 5.0.0, every built-in writing action omits `response_format` and returns plain text. Rewrite and Improve keep raw source user messages; Summarize, Translate, and Continue Writing keep JSON-encoded source/parameter input boundaries without requesting a JSON response. The package owns semantic messages, operation/wire identifiers, maximum-token metadata, response-format requirements, and structural validation policies for Rewrite, Improve, Summarize, Translate, and Continue Writing. Consumers retain specialized Grammar validation/diffing as well as the HTTP request, credentials, model, timeout, gateway URL, target-language/script validation, retry behavior, and UI state.

The shared pack contains `fix_grammar`, the app and OpenKeyboardCore rewrite renderings, `improve`, all 15 rewrite-style renderings, `summarize`, parameterized `translate`, and `continue_writing`. The existing caller-defined `WritingAction.custom` remains a non-canonical extensibility route because its identifier and wording are supplied at runtime rather than maintained by either repository.

### Bounded keyboard suggestions

`KeyboardSuggestionParser.prompt(for:)` and `KeyboardAIService.performRawSuggestionRequest` defined a separate unstructured transport operation with a JSON-only prompt contract, a 500-character input bound, corrections/predictions response schema, and no `response_format` request field. This is now the `keyboard-suggestions` pack. Parsing and the compact five-item UI policy remain in OpenKeyboard.

### Gateway diagnostics

LLM Gateway PR #10 removed five OpenKeyboard-specific tester presets from `public/admin/index.html` and intentionally left one connectivity smoke. The gateway did not construct production prompts or alter messages. The removed tester cases represented live contract diagnostics, so they are now contract fixtures rendered into a generated browser adapter. The connection smoke remains gateway-owned because it tests transport rather than a semantic operation.

## Parameters and safety boundaries

- `translate` encodes an ASCII-whitespace-trimmed target-language label in `operation_parameters` and retains the existing generic fallback when a diagnostic does not supply one. Version 2.0.0 rejects multiline, control-bearing, overlong, or non-language-label values; the value is never interpolated into operation rules.
- Rewrite styles are stable semantic operation identifiers whose wire identifier remains `rewrite`.
- Version 4.0.0 changes Rewrite/Improve request and response semantics to style-specific complete plain-text replacement while preserving their stable operation and wire identifiers; 4.0.1 clarifies the intended edit-distance distinction between Improve and generic Rewrite/Rephrase.
- Version 5.0.0 changes Summarize, Translate, and Continue Writing to plain-text responses while preserving their identifiers and JSON-safe input/parameter encoding. Summary, translation, and continuation use distinct validation modes; continuation preserves exact accepted response whitespace and rejects normalized embedded source repetition at a documented four-Unicode-scalar threshold. Grammar keeps its specialized consumer validator rather than gaining a package profile.
- Version 1.0.0 retained the original `<input_text>` delimiter rendering. Version 2.0.0 replaces it with a canonical JSON-string `source_text` value so delimiter-like, newline-bearing, or instruction-like content remains encoded data.
- Bounded suggestion input retains the existing 500-character prefix behavior, with character limits explicitly defined as Unicode scalar values in both JavaScript and Swift.
- Unknown packs, operations, or parameters are rejected by the shared renderers.
- `schemas/writing-action-response.schema.json` remains at its stable path and unchanged shape as explicitly deprecated 4.x compatibility material. No 5.x manifest entry, writing contract, rendering, gateway preset, or generated adapter references it. Keyboard suggestions retain their separate active JSON response schema.

## Existing proof routes

- Shared-package schema, rendering, fixture, generated-adapter, artifact, and Swift tests.
- OpenKeyboard core request-shape/parser tests, UI-target architecture tests, deterministic builds, opt-in live gateway diagnostics, and real-extension routes.
- Gateway Vitest compatibility tests, admin UI static tests, TypeScript build, Docker runtime smoke, and an opt-in live locally configured model route.

Version 1.0.0 retained the two product-branded writing system-role descriptions while extracting the behavior. Version 2.0.0 makes those descriptions platform-neutral and centralizes the complete user-message templates in canonical JSON. Message roles, order, operation rules, schemas, parameters, bounds, and response-format behavior otherwise remain compatible. The system-message and safe-input rendering changes are intentionally classified as breaking, covered by full operation golden fixtures, and require consumer deterministic and live proof before release.
