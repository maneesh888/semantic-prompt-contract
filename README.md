# semantic-prompt-contract

`semantic-prompt-contract` is the canonical, versioned source for reusable semantic instructions used by OpenKeyboard and its gateway diagnostics. Version `2.0.0` contains the discovered structured writing-action pack and bounded keyboard-suggestion pack with platform-neutral instructions and safe JSON-string input encoding.

The package owns operation identifiers, descriptions, parameters, semantic instructions, deterministic rendering, response-format metadata, response schemas, examples, and fixtures. It deliberately does not own UI, networking, authentication, API keys, model selection, provider routing, persistence, application state, or deployment configuration.

## Canonical format and layout

Human-reviewable JSON in `contracts/` is canonical. It owns the complete user-message template, rule-line template, system instructions, operation rules, parameters, and input encoding; renderers do not maintain independent semantic scaffolding. `contracts/manifest.json` pins the contract and schema versions and lists independently extensible packs. `schemas/` contains the canonical-file and response schemas. `fixtures/` contains gateway diagnostics, full operation-equivalence cases, and valid and invalid response examples. `src/index.js` is the side-effect-free JavaScript renderer. The Swift source under `adapters/swift/` and browser preset bundle under `adapters/browser/` are generated from the JSON and must never be edited manually.

Rendering accepts a pack, operation identifier, source input, and validated parameters. It returns ordered system/user messages, the response-format requirement, maximum token metadata, and the exact contract version. It performs no network or application side effects. Source input and dynamic parameters are always treated as untrusted data and encoded inside the canonical JSON input object, so quotes, newlines, placeholder-like text, delimiter-like text, and instruction-like content cannot escape into prompt scaffolding. Dynamic parameters are trimmed and validated against their canonical length and character constraints before encoding; they are never interpolated into operation rules. Character limits use Unicode scalar values in every runtime.

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

Together, `npm run check` and `swift test` validate canonical JSON against its schema, validate response fixtures, check operation uniqueness and parameter rejection, exercise a per-operation input regression matrix, check placeholder-bearing input and Unicode-scalar boundaries, compare JavaScript-generated golden messages with Swift byte for byte, verify generated-adapter synchronization, and inspect the package artifact. Consumer repositories retain parser, UI, transport, build, and opt-in live-model checks.

## Security

Contracts and fixtures contain no credentials or provider routing. Renderers never perform I/O beyond loading immutable package resources, never contact a model, and never log inputs. Input and parameter values remain JSON data even when they contain JSON, Markdown fences, former delimiter text, template placeholders, newlines, or attempts to override the selected operation.
