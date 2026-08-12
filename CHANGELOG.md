# Changelog

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
