import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gatewayPromptPresets } from '../src/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const readJSON = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const manifest = readJSON('contracts/manifest.json');
const writing = readJSON('contracts/writing-actions.json');
const suggestions = readJSON('contracts/keyboard-suggestions.json');

function swift(value) {
  return JSON.stringify(value).replaceAll('\\(', '\\\\(');
}

function parameterCode(operation) {
  const definitions = operation.parameters;
  const allowed = definitions.map((parameter) => swift(parameter.name)).join(', ');
  const lines = [
    `        try rejectUnknownParameters(parameters, allowed: [${allowed}], operationID: ${swift(operation.id)})`,
  ];
  for (const definition of definitions) {
    const fallback = definition.default === undefined ? 'nil' : swift(definition.default);
    const maxLength = definition.max_length === undefined ? 'nil' : definition.max_length;
    const pattern = definition.pattern === undefined ? 'nil' : swift(definition.pattern);
    lines.push(`        let ${definition.name} = try validatedParameter(parameters[${swift(definition.name)}], defaultValue: ${fallback}, required: ${definition.required}, maxLength: ${maxLength}, pattern: ${pattern}, operationID: ${swift(operation.id)}, parameter: ${swift(definition.name)})`);
  }
  return lines;
}

function ruleExpression(rule, operation) {
  let result = swift(rule);
  for (const parameter of operation.parameters) {
    const expression = parameter.default === undefined
      ? `${parameter.name} ?? ""`
      : `${parameter.name} ?? ${swift(parameter.default)}`;
    result = result.replaceAll(`{{${parameter.name}}}`, `\\(${expression})`);
  }
  return result;
}

const cases = writing.operations.map((operation) => {
  const params = parameterCode(operation);
  const rules = operation.rules.map((rule) => `            ${ruleExpression(rule, operation)}`).join(',\n');
  return `    case ${swift(operation.id)}:\n${params.join('\n')}\n        return renderWriting(operationID: ${swift(operation.id)}, wireOperationID: ${swift(operation.wire_operation_id)}, input: input, rules: [\n${rules}\n        ], maxTokens: ${operation.max_tokens})`;
}).join('\n');

const swiftSource = `// Generated from contracts/*.json by scripts/generate-adapters.mjs. Do not edit manually.
import Foundation

public enum SemanticPromptContractError: Error, Equatable {
    case unknownOperation(String)
    case unsupportedParameter(operation: String, parameter: String)
    case missingParameter(operation: String, parameter: String)
    case invalidParameter(operation: String, parameter: String)
}

public struct SemanticPromptMessage: Equatable, Sendable {
    public let role: String
    public let content: String
}

public struct SemanticPromptRendering: Equatable, Sendable {
    public let contractVersion: String
    public let schemaVersion: String
    public let packID: String
    public let operationID: String
    public let wireOperationID: String?
    public let messages: [SemanticPromptMessage]
    public let responseFormatType: String?
    public let maxTokens: Int
}

public enum SemanticPromptContract {
    public static let version = ${swift(manifest.contract_version)}
    public static let schemaVersion = ${swift(manifest.schema_version)}
    public static let writingOperationIDs = [${writing.operations.map((operation) => swift(operation.id)).join(', ')}]
    public static let writingSystemInstruction = ${swift(writing.system_instruction)}
    private static let writingUserMessageTemplate = ${swift(writing.user_message_template)}
    private static let writingRuleLineTemplate = ${swift(writing.rule_line_template)}
    public static let keyboardSuggestionsSystemInstruction = ${swift(suggestions.system_instruction)}
    private static let keyboardSuggestionsUserMessageTemplate = ${swift(suggestions.user_message_template)}
    private static let keyboardSuggestionsRuleLineTemplate = ${swift(suggestions.rule_line_template)}

    public static func renderWriting(operationID: String, input: String, parameters: [String: String] = [:]) throws -> SemanticPromptRendering {
        switch operationID.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
${cases}
        default:
            throw SemanticPromptContractError.unknownOperation(operationID)
        }
    }

    public static func renderKeyboardSuggestions(input: String) -> SemanticPromptRendering {
        let bounded = String(input.prefix(${suggestions.input.max_characters}))
        let responseExample = ${swift(suggestions.response.top_level_example)}
        let rules = [
${suggestions.operations[0].rules.map((rule) => `            ${swift(rule)}`).join(',\n')}
        ].map { substitute($0, values: ["response_example": responseExample]) }
        let numberedRules = rules.enumerated().map {
            substitute(keyboardSuggestionsRuleLineTemplate, values: ["index": String($0.offset + 1), "rule": $0.element])
        }.joined(separator: "\\n")
        let user = substitute(keyboardSuggestionsUserMessageTemplate, values: [
            "numbered_rules": numberedRules,
            "input_json": jsonStringLiteral(bounded)
        ])
        return SemanticPromptRendering(
            contractVersion: version,
            schemaVersion: schemaVersion,
            packID: ${swift(suggestions.id)},
            operationID: ${swift(suggestions.operations[0].id)},
            wireOperationID: nil,
            messages: [
                SemanticPromptMessage(role: "system", content: keyboardSuggestionsSystemInstruction),
                SemanticPromptMessage(role: "user", content: user)
            ],
            responseFormatType: nil,
            maxTokens: ${suggestions.operations[0].max_tokens}
        )
    }

    private static func renderWriting(operationID: String, wireOperationID: String, input: String, rules: [String], maxTokens: Int) -> SemanticPromptRendering {
        let numberedRules = rules.enumerated().map {
            substitute(writingRuleLineTemplate, values: ["index": String($0.offset + 1), "rule": $0.element])
        }.joined(separator: "\\n")
        let responseExample = ${swift(writing.response.top_level_example)}.replacingOccurrences(of: "{{operation}}", with: wireOperationID)
        let user = substitute(writingUserMessageTemplate, values: [
            "operation": wireOperationID,
            "response_example": responseExample,
            "numbered_rules": numberedRules,
            "input_json": jsonStringLiteral(input)
        ])
        return SemanticPromptRendering(
            contractVersion: version,
            schemaVersion: schemaVersion,
            packID: ${swift(writing.id)},
            operationID: operationID,
            wireOperationID: wireOperationID,
            messages: [
                SemanticPromptMessage(role: "system", content: writingSystemInstruction),
                SemanticPromptMessage(role: "user", content: user)
            ],
            responseFormatType: "json_object",
            maxTokens: maxTokens
        )
    }

    private static func validatedParameter(_ value: String?, defaultValue: String?, required: Bool, maxLength: Int?, pattern: String?, operationID: String, parameter: String) throws -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let selected = trimmed.isEmpty ? defaultValue : trimmed
        if required && selected == nil {
            throw SemanticPromptContractError.missingParameter(operation: operationID, parameter: parameter)
        }
        if let selected, let maxLength, selected.count > maxLength {
            throw SemanticPromptContractError.invalidParameter(operation: operationID, parameter: parameter)
        }
        if let selected, let pattern, selected.range(of: pattern, options: .regularExpression) == nil {
            throw SemanticPromptContractError.invalidParameter(operation: operationID, parameter: parameter)
        }
        return selected
    }

    private static func substitute(_ template: String, values: [String: String]) -> String {
        values.reduce(template) { result, entry in
            result.replacingOccurrences(of: "{{\\(entry.key)}}", with: entry.value)
        }
    }

    private static func jsonStringLiteral(_ value: String) -> String {
        var output = ${swift('"')}
        for scalar in value.unicodeScalars {
            switch scalar.value {
            case 0x08: output += ${swift('\\b')}
            case 0x09: output += ${swift('\\t')}
            case 0x0A: output += ${swift('\\n')}
            case 0x0C: output += ${swift('\\f')}
            case 0x0D: output += ${swift('\\r')}
            case 0x22: output += ${swift('\\"')}
            case 0x5C: output += ${swift('\\\\')}
            case 0x00...0x1F: output += String(format: ${swift('\\u%04x')}, scalar.value)
            default: output.unicodeScalars.append(scalar)
            }
        }
        output += ${swift('"')}
        return output
    }

    private static func rejectUnknownParameters(_ parameters: [String: String], allowed: Set<String>, operationID: String) throws {
        if let parameter = parameters.keys.first(where: { !allowed.contains($0) }) {
            throw SemanticPromptContractError.unsupportedParameter(operation: operationID, parameter: parameter)
        }
    }
}
`;

const renderedSwiftSource = swiftSource.replace(
  `    public static let keyboardSuggestionsSystemInstruction = ${swift(suggestions.system_instruction)}`,
  `    public static let unstructuredWritingSystemInstruction = ${swift(writing.unstructured_system_instruction)}\n` +
    `    public static let keyboardSuggestionsSystemInstruction = ${swift(suggestions.system_instruction)}`,
);
const output = join(root, 'adapters/swift/Sources/SemanticPromptContract/SemanticPromptContract.generated.swift');
const browserOutput = join(root, 'adapters/browser/semanticPromptContract.generated.js');
const browserSource = `// Generated from contracts/*.json by scripts/generate-adapters.mjs. Do not edit manually.\n` +
  `globalThis.SemanticPromptContractBrowser=Object.freeze(${JSON.stringify({
    contractVersion: manifest.contract_version,
    gatewayPromptPresets: gatewayPromptPresets(),
  })});\n`;
if (check) {
  const current = readFileSync(output, 'utf8');
  const currentBrowser = readFileSync(browserOutput, 'utf8');
  if (current !== renderedSwiftSource || currentBrowser !== browserSource) {
    console.error('Generated adapters are out of sync. Run npm run generate.');
    process.exit(1);
  }
} else {
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(dirname(browserOutput), { recursive: true });
  writeFileSync(output, renderedSwiftSource);
  writeFileSync(browserOutput, browserSource);
}
