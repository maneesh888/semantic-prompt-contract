# Changelog

## 4.0.1

- Distinguish conservative Improve from generic Rewrite/Rephrase: Improve now requests the smallest useful polish while Rewrite may broadly restructure and reword without changing meaning, facts, tone, paragraph boundaries, or relevant formatting.
- Keep the 4.0 plain-text response contract, validation profiles, operation identifiers, wire identifiers, and all named Rewrite-style semantics unchanged.

This is a patch release because it clarifies the intended edit distance of two existing plain-text operations without changing their request or response shape.

## 4.0.0

- Change `rewrite`, `rewrite_core`, all `rewrite_*` styles, and `improve` from structured suggestion objects to one complete plain-text replacement.
- Add canonical style-specific raw-input instructions with no transport `response_format`, while leaving Grammar, Translate, Summarize, Continue Writing, and keyboard-suggestion semantics unchanged.
- Add contract-owned complete-replacement validation profiles and JavaScript/Swift validation for empty output, commentary, Markdown wrappers, truncation, unsafe expansion, raw errors, unchanged output, lost line or paragraph structure, protected facts, and unusable semantic drift.
- Add validation fixtures, intentional rendering goldens, Swift parity fixtures, browser preset metadata, and a plain-text Rewrite gateway diagnostic.
- Advance the canonical schema to `2.2.0` and regenerate the Swift and browser adapters.

This is a major release because the Rewrite/Improve request and response contract no longer requires structured JSON or model-generated result metadata.

## 3.1.1

- Restore the generated browser gateway preset array after the 3.1.0 Swift adapter expansion so browser consumers receive every canonical diagnostic, including translation.

This is a patch release because it repairs a generated adapter regression without changing semantic operation behavior.

## 3.1.0

- Add a contract-owned gateway diagnostic preset for translation to Dutch.
- Generate gateway preset metadata and response validation for Swift consumers so diagnostics use the canonical operation, fixture, rendering, response schema, and result types.

This is a minor release because it adds diagnostic fixtures and adapter API without changing production operation renderings.

## 3.0.0

- Change only `fix_grammar` to send the source unchanged as the user message and return one complete corrected plain-text response.
- Add operation-level system-instruction, user-message, response-format, and temperature overrides while retaining existing structured JSON renderings for all other writing actions.
- Omit temperature for grammar correction and increase its output-token allowance so the complete source can be reproduced.
- Advance the contract schema to `2.1.0` and regenerate the Swift/browser adapters and rendering fixtures.

This is a major release because `fix_grammar` changes from structured correction patches to a complete plain-text response.

## 2.0.3

- Reword correction instructions as explicit independent patches with clear meanings for `original`, `replacement`, `text`, and `corrected_text`.
- Add a compact word-level example and remove ambiguous shorthand that can lead smaller models toward sentence rewrites.
- Add a deterministic correction-evaluation fixture for exact allowed word-level patches and a forbidden stylistic synonym change.

This is a patch release because the operation identifier, parameters, schema, and response fields are unchanged.

## 2.0.2

- Restrict correction operations to definite, local mechanical errors and explicitly forbid stylistic synonym rewrites such as `reply` to `respond`.
- Require exact source substrings and atomic correction spans of at most three words, with uncertain changes omitted.
- Apply the same correction-versus-prediction boundary to compact keyboard suggestions.

This is a patch release because it clarifies the existing atomic-correction behavior without changing identifiers, parameters, schemas, or response fields.

## 2.0.1

- Tell the summarize operation to omit source text that tries to control the model, selected operation, or response contract when factual content remains, while preserving ordinary instructional documents.
- Add deterministic JavaScript and Swift regression coverage for that live Gemma safety case.

## 2.0.0

- Move complete user-message and rule-line templates into canonical JSON so JavaScript and generated Swift adapters cannot own drifting semantic scaffolding.
- Replace fixed text delimiters with JSON-string input encoding and validate dynamic target-language parameters before substitution.
- Make system-role instructions platform-neutral and record the intentional compatibility break.
- Expand golden equivalence coverage to every writing operation plus explicit/default/empty translation parameter cases, and add the discovered input regression matrix.
- Encode dynamic operation parameters as JSON data, render placeholders in one pass, and define cross-runtime character limits in Unicode scalar values.
- Define parameter trimming as ASCII whitespace and require exact operation identifiers so invalid-input behavior is identical across runtimes.

This is a major release because system instructions and rendered user messages change. Consumers must advance their pinned gitlinks intentionally and repeat deterministic and live compatibility gates.

## 1.0.0

- Extract the discovered OpenKeyboard structured writing actions: `fix_grammar`, `rewrite`, `improve`, `summarize`, `translate`, `continue_writing`, the OpenKeyboardCore rewrite compatibility rendering, and all 15 rewrite-style variants.
- Extract the bounded `keyboard_suggestions` contract.
- Preserve the existing message order, response-format behavior, operation parameters, input bounds, and structured response wording.
- Add deterministic JavaScript and generated Swift renderers, compatibility fixtures, and package checks. Version 1.0.0 retained the original platform-specific writing system descriptions; those become platform-neutral in 2.0.0.
