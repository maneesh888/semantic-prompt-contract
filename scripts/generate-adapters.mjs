import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gatewayPromptPresets, render } from '../src/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const readJSON = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const manifest = readJSON('contracts/manifest.json');
const writing = readJSON('contracts/writing-actions.json');
const suggestions = readJSON('contracts/keyboard-suggestions.json');
const equivalence = readJSON('fixtures/rendering/equivalence.json');
const gatewayPresets = gatewayPromptPresets();

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
  const entries = definitions.length === 0
    ? ':'
    : definitions.map((definition) => `${swift(definition.name)}: ${definition.name}`).join(', ');
  lines.push(`        let validatedParameters = compactParameters([${entries}])`);
  return lines;
}

function ruleExpression(rule) {
  return swift(rule);
}

const cases = writing.operations.map((operation) => {
  const params = parameterCode(operation);
  const rules = operation.rules.map((rule) => `            ${ruleExpression(rule, operation)}`).join(',\n');
  const systemInstruction = swift(operation.system_instruction ?? writing.system_instruction);
  const userMessageMode = swift(operation.user_message_mode ?? 'template');
  const responseFormat = (operation.response_format ?? writing.response.format) === 'json_object' ? swift('json_object') : 'nil';
  const temperature = Object.hasOwn(operation, 'temperature')
    ? (operation.temperature === null ? 'nil' : String(operation.temperature))
    : '0.1';
  return `    case ${swift(operation.id)}:\n${params.join('\n')}\n        return renderWriting(operationID: ${swift(operation.id)}, wireOperationID: ${swift(operation.wire_operation_id)}, input: input, parameters: validatedParameters, systemInstruction: ${systemInstruction}, userMessageMode: ${userMessageMode}, responseFormatType: ${responseFormat}, temperature: ${temperature}, rules: [\n${rules}\n        ], maxTokens: ${operation.max_tokens})`;
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
    public let temperature: Double?
}

public struct SemanticGatewayPromptPreset: Equatable, Sendable {
    public let id: String
    public let label: String
    public let input: String
    public let parameters: [String: String]
    public let rendering: SemanticPromptRendering
    public let responseSchema: String?
    public let resultTypes: [String]
}

public enum SemanticGatewayPromptValidationError: Error, Equatable {
    case unknownPreset(String)
    case invalidResponse
    case unexpectedOperation(expected: String, actual: String)
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
    public static let gatewayPromptPresets: [SemanticGatewayPromptPreset] = [
${gatewayPresets.map((preset) => {
  const entries = Object.entries(preset.parameters);
  const parameters = entries.length === 0
    ? ':'
    : entries.map(([name, value]) => `${swift(name)}: ${swift(value)}`).join(', ');
  const responseSchema = preset.responseSchema === null ? 'nil' : swift(preset.responseSchema);
  return `        SemanticGatewayPromptPreset(id: ${swift(preset.id)}, label: ${swift(preset.label)}, input: ${swift(preset.input)}, parameters: [${parameters}], rendering: try! renderWriting(operationID: ${swift(preset.operationId)}, input: ${swift(preset.input)}, parameters: [${parameters}]), responseSchema: ${responseSchema}, resultTypes: [${preset.resultTypes.map(swift).join(', ')}])`;
}).join(',\n')}
    ]

    public static func renderWriting(operationID: String, input: String, parameters: [String: String] = [:]) throws -> SemanticPromptRendering {
        switch operationID {
${cases}
        default:
            throw SemanticPromptContractError.unknownOperation(operationID)
        }
    }

    public static func renderKeyboardSuggestions(input: String) -> SemanticPromptRendering {
        let bounded = String(input.unicodeScalars.prefix(${suggestions.input.max_characters}))
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
            maxTokens: ${suggestions.operations[0].max_tokens},
            temperature: nil
        )
    }

    public static func gatewayPromptPreset(id: String) -> SemanticGatewayPromptPreset? {
        gatewayPromptPresets.first { $0.id == id }
    }

    public static func validateGatewayPromptResponse(_ content: String, presetID: String) throws -> String {
        guard let preset = gatewayPromptPreset(id: presetID) else {
            throw SemanticGatewayPromptValidationError.unknownPreset(presetID)
        }
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw SemanticGatewayPromptValidationError.invalidResponse }
        guard preset.rendering.responseFormatType != nil else { return content }
        guard let data = trimmed.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let response = object as? [String: Any],
              let operation = nonEmptyString(response["operation"]),
              let expectedOperation = preset.rendering.wireOperationID,
              let rawResults = response["results"] as? [Any] else {
            throw SemanticGatewayPromptValidationError.invalidResponse
        }
        guard operation == expectedOperation else {
            throw SemanticGatewayPromptValidationError.unexpectedOperation(expected: expectedOperation, actual: operation)
        }
        if response.keys.contains("summary"), response["summary"] as? String == nil {
            throw SemanticGatewayPromptValidationError.invalidResponse
        }
        if response.keys.contains("corrected_text"), response["corrected_text"] as? String == nil {
            throw SemanticGatewayPromptValidationError.invalidResponse
        }

        var matchingOutput: String?
        for rawResult in rawResults {
            guard let result = rawResult as? [String: Any],
                  nonEmptyString(result["id"]) != nil,
                  let type = nonEmptyString(result["type"]),
                  Self.writingResultTypes.contains(type),
                  nonEmptyString(result["title"]) != nil,
                  result["text"] is String else {
                throw SemanticGatewayPromptValidationError.invalidResponse
            }
            if let range = result["range"] {
                guard let offsets = range as? [String: Any],
                      let start = offsets["start"] as? Int, start >= 0,
                      let end = offsets["end"] as? Int, end >= 0,
                      offsets.keys.allSatisfy({ $0 == "start" || $0 == "end" }) else {
                    throw SemanticGatewayPromptValidationError.invalidResponse
                }
            }
            if let confidence = result["confidence"] as? Double, !(0...1).contains(confidence) {
                throw SemanticGatewayPromptValidationError.invalidResponse
            }
            if preset.resultTypes.contains(type), matchingOutput == nil {
                matchingOutput = nonEmptyString(result["replacement"]) ?? nonEmptyString(result["text"])
            }
        }

        guard let matchingOutput else {
            throw SemanticGatewayPromptValidationError.invalidResponse
        }
        let output = nonEmptyString(response["corrected_text"]) ?? matchingOutput
        guard
              output.trimmingCharacters(in: .whitespacesAndNewlines) != preset.input.trimmingCharacters(in: .whitespacesAndNewlines) else {
            throw SemanticGatewayPromptValidationError.invalidResponse
        }
        return output
    }

    private static func renderWriting(operationID: String, wireOperationID: String, input: String, parameters: [String: String], systemInstruction: String, userMessageMode: String, responseFormatType: String?, temperature: Double?, rules: [String], maxTokens: Int) -> SemanticPromptRendering {
        let numberedRules = rules.enumerated().map {
            substitute(writingRuleLineTemplate, values: ["index": String($0.offset + 1), "rule": $0.element])
        }.joined(separator: "\\n")
        let responseExample = ${swift(writing.response.top_level_example)}.replacingOccurrences(of: "{{operation}}", with: wireOperationID)
        let user = userMessageMode == "raw_input" ? input : substitute(writingUserMessageTemplate, values: [
                "operation": wireOperationID,
                "response_example": responseExample,
                "numbered_rules": numberedRules,
                "input_json": jsonStringLiteral(input),
                "parameters_json": jsonStringDictionaryLiteral(parameters)
            ])
        return SemanticPromptRendering(
            contractVersion: version,
            schemaVersion: schemaVersion,
            packID: ${swift(writing.id)},
            operationID: operationID,
            wireOperationID: wireOperationID,
            messages: [
                SemanticPromptMessage(role: "system", content: systemInstruction),
                SemanticPromptMessage(role: "user", content: user)
            ],
            responseFormatType: responseFormatType,
            maxTokens: maxTokens,
            temperature: temperature
        )
    }

    private static func validatedParameter(_ value: String?, defaultValue: String?, required: Bool, maxLength: Int?, pattern: String?, operationID: String, parameter: String) throws -> String? {
        let trimmed = value.map(trimASCIIWhitespace) ?? ""
        let selected = trimmed.isEmpty ? defaultValue : trimmed
        if required && selected == nil {
            throw SemanticPromptContractError.missingParameter(operation: operationID, parameter: parameter)
        }
        if let selected, let maxLength, selected.unicodeScalars.count > maxLength {
            throw SemanticPromptContractError.invalidParameter(operation: operationID, parameter: parameter)
        }
        if let selected, let pattern, selected.range(of: pattern, options: .regularExpression) == nil {
            throw SemanticPromptContractError.invalidParameter(operation: operationID, parameter: parameter)
        }
        return selected
    }

    private static func substitute(_ template: String, values: [String: String]) -> String {
        let expression = try! NSRegularExpression(pattern: #"\\{\\{([a-z_]+)\\}\\}"#)
        let range = NSRange(template.startIndex..<template.endIndex, in: template)
        var output = ""
        var cursor = template.startIndex
        for match in expression.matches(in: template, range: range) {
            guard let placeholderRange = Range(match.range(at: 0), in: template),
                  let nameRange = Range(match.range(at: 1), in: template) else { continue }
            output.append(contentsOf: template[cursor..<placeholderRange.lowerBound])
            let name = String(template[nameRange])
            guard let value = values[name] else {
                preconditionFailure("Missing semantic prompt template value: \\(name)")
            }
            output.append(value)
            cursor = placeholderRange.upperBound
        }
        output.append(contentsOf: template[cursor...])
        return output
    }

    private static func trimASCIIWhitespace(_ value: String) -> String {
        value.trimmingCharacters(in: CharacterSet(charactersIn: " \\t\\n\\r\\u{000B}\\u{000C}"))
    }

    private static func compactParameters(_ values: [String: String?]) -> [String: String] {
        values.compactMapValues { $0 }
    }

    private static func jsonStringDictionaryLiteral(_ values: [String: String]) -> String {
        let entries = values.keys.sorted().map { key in
            jsonStringLiteral(key) + ":" + jsonStringLiteral(values[key]!)
        }
        return "{" + entries.joined(separator: ",") + "}"
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

    private static let writingResultTypes: Set<String> = ["correction", "suggestion", "summary", "translation", "warning", "explanation"]

    private static func nonEmptyString(_ value: Any?) -> String? {
        let trimmed = (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
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
const swiftParityOutput = join(root, 'adapters/swift/Tests/SemanticPromptContractTests/SemanticPromptContractParity.generated.swift');
const browserSource = `// Generated from contracts/*.json by scripts/generate-adapters.mjs. Do not edit manually.\n` +
  `globalThis.SemanticPromptContractBrowser=Object.freeze(${JSON.stringify({
    contractVersion: manifest.contract_version,
    gatewayPromptPresets,
  })});\n`;
const swiftParitySource = `// Generated from fixtures/rendering/equivalence.json by scripts/generate-adapters.mjs. Do not edit manually.
struct SemanticPromptParityFixture {
    let caseID: String
    let packID: String
    let operationID: String
    let input: String
    let parameters: [String: String]
    let expectedUserMessage: String
}

let semanticPromptParityFixtures: [SemanticPromptParityFixture] = [
${equivalence.map((fixture) => {
  const rendered = render({
    packId: fixture.pack_id,
    operationId: fixture.operation_id,
    input: fixture.input,
    parameters: fixture.parameters,
  });
  const entries = Object.entries(fixture.parameters);
  const parameters = entries.length === 0
    ? ':'
    : entries.map(([name, value]) => `${swift(name)}: ${swift(value)}`).join(', ');
  return `    SemanticPromptParityFixture(caseID: ${swift(fixture.case_id)}, packID: ${swift(fixture.pack_id)}, operationID: ${swift(fixture.operation_id)}, input: ${swift(fixture.input)}, parameters: [${parameters}], expectedUserMessage: ${swift(rendered.messages.at(-1).content)})`;
}).join(',\n')}
]
`;
if (check) {
  const current = readFileSync(output, 'utf8');
  const currentBrowser = readFileSync(browserOutput, 'utf8');
  const currentSwiftParity = readFileSync(swiftParityOutput, 'utf8');
  if (current !== renderedSwiftSource || currentBrowser !== browserSource || currentSwiftParity !== swiftParitySource) {
    console.error('Generated adapters are out of sync. Run npm run generate.');
    process.exit(1);
  }
} else {
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(dirname(browserOutput), { recursive: true });
  mkdirSync(dirname(swiftParityOutput), { recursive: true });
  writeFileSync(output, renderedSwiftSource);
  writeFileSync(browserOutput, browserSource);
  writeFileSync(swiftParityOutput, swiftParitySource);
}
