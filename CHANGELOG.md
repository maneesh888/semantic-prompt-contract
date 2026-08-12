# Changelog

## 1.0.0

- Extract the discovered OpenKeyboard structured writing actions: `fix_grammar`, `rewrite`, `improve`, `summarize`, `translate`, `continue_writing`, the OpenKeyboardCore rewrite compatibility rendering, and all 15 rewrite-style variants.
- Extract the bounded `keyboard_suggestions` contract.
- Preserve the exact existing message order, system-role descriptions, response-format behavior, operation parameters, input bounds, and structured response wording.
- Add platform-neutral schemas, deterministic JavaScript and generated Swift renderers, compatibility fixtures, and package checks.
