import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gatewayPromptPresets, render } from '../src/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const readJSON = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const readText = (path) => readFileSync(join(root, path), 'utf8');
const manifest = readJSON('contracts/manifest.json');
const writing = readJSON('contracts/writing-actions.json');
const suggestions = readJSON('contracts/keyboard-suggestions.json');
const equivalence = readJSON('fixtures/rendering/equivalence.json');
const plainTextValidationFixtures = [
  ...readJSON('fixtures/plain-text-validation/rewrite-replacements.json'),
  ...readJSON('fixtures/plain-text-validation/writing-actions.json'),
  ...readJSON('fixtures/unicode/protected-emoji-cases.json'),
];
const gatewayPresets = gatewayPromptPresets();

const unicode17GraphemeBreakFixtures = readText('fixtures/unicode/GraphemeBreakTest-17.0.0.txt')
  .split('\n')
  .map((line, index) => ({ line: index + 1, data: line.split('#', 1)[0].trim() }))
  .filter(({ data }) => data.length > 0)
  .map(({ line, data }) => {
    const expectedClusters = [];
    let current = '';
    for (const token of data.split(/\s+/u)) {
      if (token === '÷') {
        if (current.length > 0) expectedClusters.push(current);
        current = '';
      } else if (token !== '×') {
        current += String.fromCodePoint(Number.parseInt(token, 16));
      }
    }
    if (current.length > 0) expectedClusters.push(current);
    return { line, input: expectedClusters.join(''), expectedClusters };
  });

const parseEncodedRange = (encodedRange) => {
  const [lower, upper = lower] = encodedRange.trim().split('..');
  return [Number.parseInt(lower, 16), Number.parseInt(upper, 16)];
};
const parseUnicodePropertyRanges = (path, property) => readText(path)
  .split('\n')
  .map((line) => line.split('#', 1)[0].trim())
  .filter((line) => line.length > 0)
  .map((line) => line.split(';').map((part) => part.trim()))
  .filter((parts) => parts[1] === property)
  .map(([encodedRange]) => parseEncodedRange(encodedRange));

const unicode17EmojiPresentationRanges = parseUnicodePropertyRanges(
  'fixtures/unicode/emoji-data-17.0.0.txt',
  'Emoji_Presentation',
);
const unicode17ExtendedPictographicRanges = parseUnicodePropertyRanges(
  'fixtures/unicode/emoji-data-17.0.0.txt',
  'Extended_Pictographic',
);
const graphemeBreakProperties = [
  ['CR', 'Cr'],
  ['LF', 'Lf'],
  ['Control', 'Control'],
  ['Extend', 'Extend'],
  ['Regional_Indicator', 'RegionalIndicator'],
  ['Prepend', 'Prepend'],
  ['SpacingMark', 'SpacingMark'],
  ['L', 'L'],
  ['V', 'V'],
  ['T', 'T'],
  ['LV', 'Lv'],
  ['LVT', 'LvT'],
  ['ZWJ', 'Zwj'],
].map(([property, name]) => ({
  name,
  ranges: parseUnicodePropertyRanges('fixtures/unicode/GraphemeBreakProperty-17.0.0.txt', property),
}));
const parseInCbRanges = (kind) => readText('fixtures/unicode/IndicConjunctBreak-17.0.0.txt')
  .split('\n')
  .map((line) => line.split('#', 1)[0].trim())
  .filter((line) => line.length > 0)
  .map((line) => line.split(';').map((part) => part.trim()))
  .filter((parts) => parts[1] === 'InCB' && parts[2] === kind)
  .map(([encodedRange]) => parseEncodedRange(encodedRange));
const unicode17InCbConsonantRanges = parseInCbRanges('Consonant');
const unicode17InCbExtendRanges = parseInCbRanges('Extend');
const unicode17InCbLinkerRanges = parseInCbRanges('Linker');

const containsUnicode17EmojiPresentation = (value) => [...value].some((scalar) => {
    const codePoint = scalar.codePointAt(0);
    return unicode17EmojiPresentationRanges.some(([lower, upper]) => codePoint >= lower && codePoint <= upper);
  });
const unicode17ProtectedEmojiGraphemeBreakFixtures = unicode17GraphemeBreakFixtures
  .map((fixture) => ({
    ...fixture,
    expectedProtectedClusters: fixture.expectedClusters.filter(containsUnicode17EmojiPresentation),
  }))
  .filter(({ expectedProtectedClusters }) => expectedProtectedClusters.length > 0);

function swift(value) {
  return JSON.stringify(value)
    .replaceAll('\\(', '\\\\(')
    .replace(/\\u([0-9a-f]{4})/giu, '\\u{$1}');
}

function kotlin(value) {
  return JSON.stringify(value).replaceAll('$', '\\$');
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

function plainTextValidationCode(policy) {
  if (policy === null) return 'nil';
  return `SemanticPlainTextValidationPolicy(mode: ${swift(policy.mode)}, rejectUnchanged: ${policy.reject_unchanged}, preserveBoundaryWhitespace: ${policy.preserve_boundary_whitespace}, preserveLineBreaks: ${policy.preserve_line_breaks}, rejectNewMarkdownFences: ${policy.reject_new_markdown_fences}, rejectCommentary: ${policy.reject_commentary}, rejectRawErrorText: ${policy.reject_raw_error_text}, rejectSourceFragment: ${policy.reject_source_fragment}, rejectJSONContainers: ${policy.reject_json_containers}, rejectTruncationMarkers: ${policy.reject_truncation_markers}, rejectSourceRepetition: ${policy.reject_source_repetition}, minimumEmbeddedSourceRepetitionCharacters: ${policy.minimum_embedded_source_repetition_characters}, preserveResponseWhitespace: ${policy.preserve_response_whitespace}, enforceLengthRatio: ${policy.enforce_length_ratio}, enforceMaximumAddedCharacters: ${policy.enforce_maximum_added_characters}, enforceWordOverlap: ${policy.enforce_word_overlap}, allowUnchangedBelowSourceCharacters: ${policy.allow_unchanged_below_source_characters}, minimumLengthRatio: ${policy.minimum_length_ratio}, maximumLengthRatio: ${policy.maximum_length_ratio}, maximumAddedCharacters: ${policy.maximum_added_characters}, maximumOutputCharacters: ${policy.maximum_output_characters}, minimumWordOverlapRatio: ${policy.minimum_word_overlap_ratio}, protectedTokenTypes: [${policy.protected_token_types.map(swift).join(', ')}], requiresTargetLanguageValidation: ${policy.requires_target_language_validation})`;
}

const cases = writing.operations.map((operation) => {
  const params = parameterCode(operation);
  const rules = operation.rules.map((rule) => `            ${ruleExpression(rule, operation)}`).join(',\n');
  const renderedMetadata = render({ operationId: operation.id, input: '' });
  const systemInstruction = swift(renderedMetadata.messages[0].content);
  const userMessageMode = swift(operation.user_message_mode ?? 'template');
  const responseFormat = operation.response_format === 'json_object' ? swift('json_object') : 'nil';
  const validation = plainTextValidationCode(renderedMetadata.plainTextValidation);
  const temperature = Object.hasOwn(operation, 'temperature')
    ? (operation.temperature === null ? 'nil' : String(operation.temperature))
    : '0.1';
  return `    case ${swift(operation.id)}:\n${params.join('\n')}\n        return renderWriting(operationID: ${swift(operation.id)}, wireOperationID: ${swift(operation.wire_operation_id)}, input: input, parameters: validatedParameters, systemInstruction: ${systemInstruction}, userMessageMode: ${userMessageMode}, responseFormatType: ${responseFormat}, temperature: ${temperature}, plainTextValidationPolicy: ${validation}, rules: [\n${rules}\n        ], maxTokens: ${operation.max_tokens})`;
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
    public let plainTextValidationPolicy: SemanticPlainTextValidationPolicy?
}

public struct SemanticPlainTextValidationPolicy: Equatable, Sendable {
    public let mode: String
    public let rejectUnchanged: Bool
    public let preserveBoundaryWhitespace: Bool
    public let preserveLineBreaks: Bool
    public let rejectNewMarkdownFences: Bool
    public let rejectCommentary: Bool
    public let rejectRawErrorText: Bool
    public let rejectSourceFragment: Bool
    public let rejectJSONContainers: Bool
    public let rejectTruncationMarkers: Bool
    public let rejectSourceRepetition: Bool
    public let minimumEmbeddedSourceRepetitionCharacters: Int
    public let preserveResponseWhitespace: Bool
    public let enforceLengthRatio: Bool
    public let enforceMaximumAddedCharacters: Bool
    public let enforceWordOverlap: Bool
    public let allowUnchangedBelowSourceCharacters: Int
    public let minimumLengthRatio: Double
    public let maximumLengthRatio: Double
    public let maximumAddedCharacters: Int
    public let maximumOutputCharacters: Int
    public let minimumWordOverlapRatio: Double
    public let protectedTokenTypes: [String]
    public let requiresTargetLanguageValidation: Bool
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
            temperature: nil,
            plainTextValidationPolicy: nil
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
        guard preset.rendering.plainTextValidationPolicy != nil else { return content }
        return try validatePlainTextResponse(content, rendering: preset.rendering, source: preset.input)
    }

    private static func renderWriting(operationID: String, wireOperationID: String, input: String, parameters: [String: String], systemInstruction: String, userMessageMode: String, responseFormatType: String?, temperature: Double?, plainTextValidationPolicy: SemanticPlainTextValidationPolicy?, rules: [String], maxTokens: Int) -> SemanticPromptRendering {
        let numberedRules = rules.enumerated().map {
            substitute(writingRuleLineTemplate, values: ["index": String($0.offset + 1), "rule": $0.element])
        }.joined(separator: "\\n")
        let user = userMessageMode == "raw_input" ? input : substitute(writingUserMessageTemplate, values: [
                "operation": wireOperationID,
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
            temperature: temperature,
            plainTextValidationPolicy: plainTextValidationPolicy
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
const kotlinDataOutput = join(root, 'adapters/kotlin/src/commonMain/kotlin/com/maneesh/semanticpromptcontract/CanonicalContractData.generated.kt');
const kotlinUnicodeDataOutput = join(root, 'adapters/kotlin/src/commonMain/kotlin/com/maneesh/semanticpromptcontract/UnicodeData.generated.kt');
const kotlinParityOutput = join(root, 'adapters/kotlin/src/commonTest/kotlin/com/maneesh/semanticpromptcontract/SemanticPromptContractParity.generated.kt');
const browserSource = `// Generated from contracts/*.json by scripts/generate-adapters.mjs. Do not edit manually.\n` +
  `globalThis.SemanticPromptContractBrowser=Object.freeze(${JSON.stringify({
    contractVersion: manifest.contract_version,
    gatewayPromptPresets: gatewayPresets,
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

struct SemanticPlainTextValidationFixture {
    let caseID: String
    let operationID: String
    let source: String
    let response: String
    let valid: Bool
    let expected: String?
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

let semanticPlainTextValidationFixtures: [SemanticPlainTextValidationFixture] = [
${plainTextValidationFixtures.map((fixture) => `    SemanticPlainTextValidationFixture(caseID: ${swift(fixture.id)}, operationID: ${swift(fixture.operation_id)}, source: ${swift(fixture.source)}, response: ${swift(fixture.response)}, valid: ${fixture.valid}, expected: ${fixture.expected === undefined ? 'nil' : swift(fixture.expected)})`).join(',\n')}
]

struct UnicodeGraphemeBreakFixture {
    let line: Int
    let input: String
    let expectedProtectedClusters: [String]
}

let unicode17ProtectedEmojiGraphemeBreakFixtures: [UnicodeGraphemeBreakFixture] = [
${unicode17ProtectedEmojiGraphemeBreakFixtures.map((fixture) => `    UnicodeGraphemeBreakFixture(line: ${fixture.line}, input: ${swift(fixture.input)}, expectedProtectedClusters: [${fixture.expectedProtectedClusters.map(swift).join(', ')}])`).join(',\n')}
]
`;
const kotlinDataSource = `// Generated from contracts/*.json by scripts/generate-adapters.mjs. Do not edit manually.
package com.maneesh.semanticpromptcontract

internal object CanonicalContractData {
    const val manifestJson: String = ${kotlin(JSON.stringify(manifest))}
    const val writingJson: String = ${kotlin(JSON.stringify(writing))}
    const val suggestionsJson: String = ${kotlin(JSON.stringify(suggestions))}
    const val gatewayPresetsJson: String = ${kotlin(JSON.stringify(readJSON('fixtures/gateway-presets.json')))}
}
`;
const kotlinUnicodeDataSource = `// Generated from fixtures/unicode/*-17.0.0.txt by scripts/generate-adapters.mjs. Do not edit manually.
package com.maneesh.semanticpromptcontract

internal val unicode17EmojiPresentationRanges: IntArray = intArrayOf(
${unicode17EmojiPresentationRanges.map(([lower, upper]) => `    0x${lower.toString(16).toUpperCase()}, 0x${upper.toString(16).toUpperCase()},`).join('\n')}
)

internal val unicode17ExtendedPictographicRanges: IntArray = intArrayOf(
${unicode17ExtendedPictographicRanges.map(([lower, upper]) => `    0x${lower.toString(16).toUpperCase()}, 0x${upper.toString(16).toUpperCase()},`).join('\n')}
)

${graphemeBreakProperties.map(({ name, ranges }) => `internal val unicode17Grapheme${name}Ranges: IntArray = intArrayOf(\n${ranges.map(([lower, upper]) => `    0x${lower.toString(16).toUpperCase()}, 0x${upper.toString(16).toUpperCase()},`).join('\n')}\n)`).join('\n\n')}

internal val unicode17InCbConsonantRanges: IntArray = intArrayOf(
${unicode17InCbConsonantRanges.map(([lower, upper]) => `    0x${lower.toString(16).toUpperCase()}, 0x${upper.toString(16).toUpperCase()},`).join('\n')}
)

internal val unicode17InCbExtendRanges: IntArray = intArrayOf(
${unicode17InCbExtendRanges.map(([lower, upper]) => `    0x${lower.toString(16).toUpperCase()}, 0x${upper.toString(16).toUpperCase()},`).join('\n')}
)

internal val unicode17InCbLinkerRanges: IntArray = intArrayOf(
${unicode17InCbLinkerRanges.map(([lower, upper]) => `    0x${lower.toString(16).toUpperCase()}, 0x${upper.toString(16).toUpperCase()},`).join('\n')}
)
`;
const kotlinParitySource = `// Generated from canonical fixtures by scripts/generate-adapters.mjs. Do not edit manually.
package com.maneesh.semanticpromptcontract

internal val semanticPromptParityFixtures: List<SemanticPromptParityFixture> = listOf(
${equivalence.map((fixture) => {
  const rendered = render({
    packId: fixture.pack_id,
    operationId: fixture.operation_id,
    input: fixture.input,
    parameters: fixture.parameters,
  });
  const entries = Object.entries(fixture.parameters);
  const parameters = entries.length === 0
    ? 'emptyMap()'
    : `mapOf(${entries.map(([name, value]) => `${kotlin(name)} to ${kotlin(value)}`).join(', ')})`;
  return `    SemanticPromptParityFixture(caseId = ${kotlin(fixture.case_id)}, packId = ${kotlin(fixture.pack_id)}, operationId = ${kotlin(fixture.operation_id)}, input = ${kotlin(fixture.input)}, parameters = ${parameters}, expectedUserMessage = ${kotlin(rendered.messages.at(-1).content)})`;
}).join(',\n')}
)

internal val semanticPlainTextValidationFixtures: List<SemanticPlainTextValidationFixture> = listOf(
${plainTextValidationFixtures.map((fixture) => `    SemanticPlainTextValidationFixture(caseId = ${kotlin(fixture.id)}, operationId = ${kotlin(fixture.operation_id)}, source = ${kotlin(fixture.source)}, response = ${kotlin(fixture.response)}, valid = ${fixture.valid}, expected = ${fixture.expected === undefined ? 'null' : kotlin(fixture.expected)}, expectedError = ${fixture.expected_error === undefined ? 'null' : kotlin(fixture.expected_error)})`).join(',\n')}
)

internal data class UnicodeGraphemeBreakFixture(
    val line: Int,
    val input: String,
    val expectedClusters: List<String>,
)

internal val unicode17GraphemeBreakFixtures: List<UnicodeGraphemeBreakFixture> = listOf(
${unicode17GraphemeBreakFixtures.map((fixture) => `    UnicodeGraphemeBreakFixture(line = ${fixture.line}, input = ${kotlin(fixture.input)}, expectedClusters = listOf(${fixture.expectedClusters.map(kotlin).join(', ')}))`).join(',\n')}
)
`;
if (check) {
  const current = readFileSync(output, 'utf8');
  const currentBrowser = readFileSync(browserOutput, 'utf8');
  const currentSwiftParity = readFileSync(swiftParityOutput, 'utf8');
  const currentKotlinData = readFileSync(kotlinDataOutput, 'utf8');
  const currentKotlinUnicodeData = readFileSync(kotlinUnicodeDataOutput, 'utf8');
  const currentKotlinParity = readFileSync(kotlinParityOutput, 'utf8');
  if (current !== renderedSwiftSource
      || currentBrowser !== browserSource
      || currentSwiftParity !== swiftParitySource
      || currentKotlinData !== kotlinDataSource
      || currentKotlinUnicodeData !== kotlinUnicodeDataSource
      || currentKotlinParity !== kotlinParitySource) {
    console.error('Generated adapters are out of sync. Run npm run generate.');
    process.exit(1);
  }
} else {
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(dirname(browserOutput), { recursive: true });
  mkdirSync(dirname(swiftParityOutput), { recursive: true });
  mkdirSync(dirname(kotlinDataOutput), { recursive: true });
  mkdirSync(dirname(kotlinUnicodeDataOutput), { recursive: true });
  mkdirSync(dirname(kotlinParityOutput), { recursive: true });
  writeFileSync(output, renderedSwiftSource);
  writeFileSync(browserOutput, browserSource);
  writeFileSync(swiftParityOutput, swiftParitySource);
  writeFileSync(kotlinDataOutput, kotlinDataSource);
  writeFileSync(kotlinUnicodeDataOutput, kotlinUnicodeDataSource);
  writeFileSync(kotlinParityOutput, kotlinParitySource);
}
