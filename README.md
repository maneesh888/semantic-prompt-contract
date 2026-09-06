# semantic-prompt-contract

`semantic-prompt-contract` is the canonical, versioned source for reusable semantic instructions used by OpenKeyboard and its gateway diagnostics. Version `5.0.0` makes every built-in writing action—Grammar, Rewrite, Improve, Summarize, Translate, and Continue Writing—return plain text with no transport `response_format` or active response schema. The separately defined keyboard-suggestions pack keeps its prompt-owned JSON contract.

The package owns operation identifiers, descriptions, parameters, semantic instructions, deterministic rendering, response-format metadata, response schemas, examples, and fixtures. It owns structural validation policies for Rewrite, Improve, Summarize, Translate, and Continue Writing; consumers retain specialized Grammar validation and diffing. It deliberately does not own UI, networking, authentication, API keys, model selection, provider routing, persistence, application state, or deployment configuration.

## Canonical format and layout

Human-reviewable JSON in `contracts/` is canonical. It owns the complete user-message templates, plain-text instruction template, system instructions, operation rules, parameters, validation profiles, and input encoding; renderers do not maintain independent semantic scaffolding. `contracts/manifest.json` pins the contract and schema versions and lists independently extensible packs. `schemas/` contains canonical-file schemas, the active keyboard-suggestions response schema, and the explicitly deprecated writing-envelope schema retained at its stable path only for 4.x compatibility. `fixtures/` contains gateway diagnostics, full operation-equivalence cases, operation-specific plain-text validation cases, active plain-text response examples, and isolated legacy compatibility examples. `src/index.js` is the side-effect-free JavaScript renderer and validator. Swift rendering metadata is generated under `adapters/swift/`; the package-owned Rewrite/Improve/Summarize/Translate/Continue validator is fixture-parity tested against JavaScript. The browser preset bundle is generated from the same canonical data.

Rendering accepts a pack, operation identifier, source input, and validated parameters. It returns ordered system/user messages, optional response-format metadata, operation-specific plain-text validation policy, maximum token metadata, and the exact contract version. It performs no network or application side effects. Every writing rendering has null/nil response-format and response-schema metadata. Raw-input operations place the source unchanged in the user message under a dedicated system instruction that treats it only as data. Summarize, Translate, and Continue Writing encode source and parameters inside the canonical JSON input object while still requesting one plain-text result, so quotes, newlines, placeholder-like text, delimiter-like text, and instruction-like content cannot escape into prompt scaffolding. Dynamic parameters are trimmed with the explicit ASCII set U+0009 through U+000D plus U+0020 and validated against their canonical length and character constraints before encoding; they are never interpolated into operation rules. Character limits use Unicode scalar values in every runtime. Operation identifiers require an exact canonical match.

Plain-text validation has four explicit modes: complete replacement, summary, translation, and continuation. Summary allows unchanged output only for sources of at most 160 Unicode scalars. Translation preserves protected tokens and ordered newline-run structure but marks target-language validation as a required caller-owned semantic check. Emoji tokens are compared as extended grapheme clusters, including ZWJ families and skin-tone sequences. Continuation rejects normalized, case-insensitive embedded source repetition beginning at four Unicode scalars (exact duplicate responses are rejected at any length) and returns accepted response whitespace exactly so the caller can append it without changing the model's boundary. Newly introduced Markdown fence sequences and generic result wrappers are rejected anywhere applicable. Grammar intentionally has no package validation profile and remains covered by specialized consumer validation/diffing. Prefer validating with the exact rendering returned for the request; the operation-ID overload remains for source compatibility.

## Versioning

The package follows semantic versioning. Prompt clarifications that preserve observable behavior are patches. Backward-compatible operations, optional fields, or fixtures are minor releases. Identifier, required-field, schema, parameter, or rendering breaks require a major release. Consumers pin the Git commit through their vendored submodule and update intentionally.

## Adding or changing contracts

Add a pack to `contracts/`, register it in the manifest, add its response schema and representative fixtures, and add deterministic/schema tests. Both renderers consume the canonical templates; do not add prompt wording to renderer or generator code. Change existing instructions only after capturing consumer equivalence fixtures for every affected operation and parameter variation and classifying the version impact. Run `npm run generate`, inspect the generated diff, then run all checks.

## Validation

```bash
npm ci
npm run check
swift test
```

Together, `npm run check` and `swift test` validate canonical JSON against its schema, validate active plain-text and legacy compatibility fixtures, prove that no active writing rendering references the deprecated envelope, check operation uniqueness and parameter rejection, exercise a per-operation input regression matrix, check placeholder-bearing input and Unicode-scalar boundaries, compare JavaScript-generated golden messages with Swift byte for byte, verify JavaScript/Swift validation parity, verify generated-adapter synchronization, and inspect the package artifact. Consumer repositories retain specialized Grammar validation/diffing, UI state, transport, target-language validation/retry, build, and opt-in live-model checks.

## Security

Contracts and fixtures contain no credentials or provider routing. Renderers and validators never perform I/O beyond loading immutable package resources, never contact a model, and never log inputs. Raw-input operations are protected by dedicated system instructions; template-mode source and parameter values remain JSON-encoded data even when they contain JSON, Markdown fences, former delimiter text, template placeholders, newlines, or attempts to override the selected operation. The JSON encoding is an input trust boundary, not a structured response request.
