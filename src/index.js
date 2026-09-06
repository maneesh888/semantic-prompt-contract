import { readFileSync } from 'node:fs';

const packageRoot = new URL('../', import.meta.url);

function readJSON(path) {
  return JSON.parse(readFileSync(new URL(path, packageRoot), 'utf8'));
}

export const manifest = Object.freeze(readJSON('contracts/manifest.json'));
const packs = new Map(manifest.packs.map((entry) => [entry.id, Object.freeze(readJSON(`contracts/${entry.path}`))]));
export const unstructuredWritingSystemInstruction = packs.get('writing-actions').unstructured_system_instruction;

export class SemanticPromptContractError extends Error {}

function substitute(template, values) {
  return template.replace(/\{\{([a-z_]+)\}\}/g, (_, name) => {
    if (!Object.hasOwn(values, name)) throw new SemanticPromptContractError(`Missing template value: ${name}`);
    return values[name];
  });
}

function encodeInput(value, encoding) {
  if (encoding !== 'json_string') throw new SemanticPromptContractError(`Unsupported input encoding: ${encoding}`);
  return JSON.stringify(value);
}

function encodeParameters(values) {
  return JSON.stringify(Object.fromEntries(Object.keys(values).sort().map((name) => [name, values[name]])));
}

function trimASCIIWhitespace(value) {
  return value.replace(/^[\u0009-\u000d\u0020]+|[\u0009-\u000d\u0020]+$/g, '');
}

function validatedParameters(operation, supplied) {
  if (supplied === null || typeof supplied !== 'object' || Array.isArray(supplied)) {
    throw new SemanticPromptContractError('parameters must be an object');
  }
  const definitions = new Map(operation.parameters.map((parameter) => [parameter.name, parameter]));
  for (const name of Object.keys(supplied)) {
    if (!definitions.has(name)) throw new SemanticPromptContractError(`Unsupported parameter for ${operation.id}: ${name}`);
  }
  const output = {};
  for (const definition of operation.parameters) {
    let value = supplied[definition.name];
    if (value === undefined || (definition.trim && typeof value === 'string' && trimASCIIWhitespace(value) === '')) value = definition.default;
    if (value === undefined && definition.required) {
      throw new SemanticPromptContractError(`Missing required parameter for ${operation.id}: ${definition.name}`);
    }
    if (value !== undefined && typeof value !== definition.type) {
      throw new SemanticPromptContractError(`${definition.name} must be a ${definition.type}`);
    }
    if (typeof value === 'string' && definition.trim) value = trimASCIIWhitespace(value);
    if (typeof value === 'string' && definition.max_length !== undefined && [...value].length > definition.max_length) {
      throw new SemanticPromptContractError(`${definition.name} exceeds maximum length ${definition.max_length}`);
    }
    if (typeof value === 'string' && definition.pattern !== undefined) {
      const pattern = new RegExp(definition.pattern, 'u');
      if (!pattern.test(value)) throw new SemanticPromptContractError(`${definition.name} has an unsupported value`);
    }
    if (value !== undefined) output[definition.name] = value;
  }
  return output;
}

function renderUserMessage(pack, operation, input, parameters) {
  const values = validatedParameters(operation, parameters);
  if (operation.user_message_mode === 'raw_input') return input;
  const parametersJson = encodeParameters(values);
  const wireOperation = operation.wire_operation_id;
  values.operation = wireOperation;
  if (pack.response?.top_level_example !== undefined) {
    values.response_example = substitute(pack.response.top_level_example, values);
  }
  const rules = operation.rules.map((rule) => substitute(rule, values));
  values.numbered_rules = rules.map((rule, index) => substitute(pack.rule_line_template, {
    index: String(index + 1),
    rule,
  })).join('\n');
  const boundedInput = pack.input.max_characters === undefined
    ? input
    : [...input].slice(0, pack.input.max_characters).join('');
  values.input_json = encodeInput(boundedInput, pack.input.encoding);
  values.parameters_json = parametersJson;
  return substitute(pack.user_message_template, values);
}

function plainTextSystemInstruction(pack, operation) {
  if (operation.system_instruction !== undefined) return operation.system_instruction;
  if (operation.plain_text_instruction === undefined) return pack.system_instruction;
  return substitute(pack.plain_text_system_instruction_template, {
    plain_text_instruction: operation.plain_text_instruction,
  });
}

function plainTextValidation(pack, operation) {
  if (operation.plain_text_validation_profile === undefined) return null;
  const policy = pack.plain_text_validation_profiles?.[operation.plain_text_validation_profile];
  if (policy === undefined) {
    throw new SemanticPromptContractError(
      `Unknown plain-text validation profile for ${operation.id}: ${operation.plain_text_validation_profile}`,
    );
  }
  return Object.freeze({ ...policy, protected_token_types: Object.freeze([...policy.protected_token_types]) });
}

export function render({ packId = 'writing-actions', operationId, input, parameters = {} }) {
  if (typeof input !== 'string') throw new SemanticPromptContractError('input must be a string');
  const pack = packs.get(packId);
  if (!pack) throw new SemanticPromptContractError(`Unknown contract pack: ${packId}`);
  const operation = pack.operations.find((candidate) => candidate.id === operationId);
  if (!operation) throw new SemanticPromptContractError(`Unknown operation for ${packId}: ${operationId}`);
  const user = renderUserMessage(pack, operation, input, parameters);
  const responseFormat = operation.response_format ?? pack.response?.format ?? null;
  const validation = plainTextValidation(pack, operation);
  return Object.freeze({
    contractVersion: pack.contract_version,
    schemaVersion: pack.schema_version,
    packId,
    operationId: operation.id,
    wireOperationId: operation.wire_operation_id,
    messages: Object.freeze([
      Object.freeze({ role: 'system', content: plainTextSystemInstruction(pack, operation) }),
      Object.freeze({ role: 'user', content: user }),
    ]),
    responseFormat: responseFormat === 'json_object' ? Object.freeze({ type: 'json_object' }) : null,
    responseSchema: responseFormat === 'json_object' ? (pack.response?.schema ?? null) : null,
    maxTokens: operation.max_tokens,
    temperature: Object.hasOwn(operation, 'temperature') ? operation.temperature : 0.1,
    plainTextValidation: validation,
  });
}

function coreAndBoundaryWhitespace(value) {
  const leading = value.match(/^[\u0009-\u000d\u0020]*/u)?.[0] ?? '';
  const trailing = value.match(/[\u0009-\u000d\u0020]*$/u)?.[0] ?? '';
  return { leading, core: value.slice(leading.length, value.length - trailing.length), trailing };
}

function protectedTokens(value, type) {
  if (type === 'emoji') {
    const segmenter = new Intl.Segmenter('en-US', { granularity: 'grapheme' });
    return [...segmenter.segment(value)]
      .map(({ segment }) => segment)
      .filter((segment) => /\p{Emoji_Presentation}/u.test(segment));
  }
  const patterns = {
    number: /[+-]?\d+(?:[.,:/-]\d+)*/gu,
    url: /https?:\/\/[^\s<>()]+/giu,
    email: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu,
    mention: /@[\p{L}\p{N}_]+/gu,
    hashtag: /#[\p{L}\p{N}_]+/gu,
    markdown_link_destination: /\]\(([^)]+)\)/gu,
  };
  const pattern = patterns[type];
  if (pattern === undefined) throw new SemanticPromptContractError(`Unsupported protected token type: ${type}`);
  return [...value.matchAll(pattern)].map((match) => type === 'markdown_link_destination' ? match[1] : match[0]);
}

function sameMultiset(left, right) {
  const counts = (values) => values.reduce((result, value) => {
    result.set(value, (result.get(value) ?? 0) + 1);
    return result;
  }, new Map());
  const leftCounts = counts(left);
  const rightCounts = counts(right);
  return leftCounts.size === rightCounts.size
    && [...leftCounts].every(([value, count]) => rightCounts.get(value) === count);
}

function sameSequence(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function wordOverlapRatio(source, replacement) {
  const words = (value) => [...value.toLocaleLowerCase('en-US').matchAll(/[\p{L}\p{M}\p{N}]+/gu)].map((match) => match[0]);
  const sourceWords = [...new Set(words(source))];
  if (sourceWords.length < 4) return 1;
  const replacementWords = new Set(words(replacement));
  return sourceWords.filter((word) => replacementWords.has(word)).length / sourceWords.length;
}

function startsWithNewSignal(value, source, signals) {
  const inspected = value.toLocaleLowerCase('en-US');
  const sourceInspected = source.toLocaleLowerCase('en-US');
  return signals.some((signal) => inspected.startsWith(signal) && !sourceInspected.startsWith(signal));
}

function endsWithNewSignal(value, source, signals) {
  const inspected = value.toLocaleLowerCase('en-US');
  const sourceInspected = source.toLocaleLowerCase('en-US');
  return signals.some((signal) => inspected.endsWith(signal) && !sourceInspected.endsWith(signal));
}

function isJSONContainer(value) {
  return value.startsWith('{') || value.startsWith('[');
}

function hasTruncationMarker(value) {
  return /(?:^|\s)(?:\[(?:output\s+)?truncated\]|<(?:output\s+)?truncated>|\[incomplete\])$/iu.test(value);
}

function normalizedRepetitionText(value) {
  const normalized = value.normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\u0009-\u000d\u0020]+/gu, ' ');
  return trimASCIIWhitespace(normalized);
}

function isWordScalar(value) {
  return /[\p{L}\p{M}\p{N}]/u.test(value);
}

function containsAtWordBoundaries(response, source) {
  const responseScalars = [...response];
  const sourceScalars = [...source];
  const lastStart = responseScalars.length - sourceScalars.length;
  for (let start = 0; start <= lastStart; start += 1) {
    if (!sourceScalars.every((scalar, offset) => responseScalars[start + offset] === scalar)) continue;
    const end = start + sourceScalars.length;
    const leftBoundary = !isWordScalar(sourceScalars[0])
      || start === 0
      || !isWordScalar(responseScalars[start - 1]);
    const rightBoundary = !isWordScalar(sourceScalars.at(-1))
      || end === responseScalars.length
      || !isWordScalar(responseScalars[end]);
    if (leftBoundary && rightBoundary) return true;
  }
  return false;
}

function repeatsCompleteSource(source, response, minimumEmbeddedCharacters) {
  const normalizedSource = normalizedRepetitionText(source);
  const normalizedResponse = normalizedRepetitionText(response);
  if (normalizedSource.length === 0) return false;
  if (normalizedResponse === normalizedSource) return true;
  if ([...normalizedSource].length < minimumEmbeddedCharacters) return false;
  return containsAtWordBoundaries(normalizedResponse, normalizedSource);
}

function validationRendering({ rendering, operationId, source, parameters }) {
  if (rendering !== undefined) {
    if (rendering === null || typeof rendering !== 'object' || rendering.packId !== 'writing-actions') {
      throw new SemanticPromptContractError('rendering must be a writing-actions rendering');
    }
    if (operationId !== undefined && operationId !== rendering.operationId) {
      throw new SemanticPromptContractError('operationId does not match rendering');
    }
    return rendering;
  }
  if (typeof operationId !== 'string') {
    throw new SemanticPromptContractError('operationId or rendering is required');
  }
  return render({ operationId, input: source, parameters });
}

export function validatePlainTextResponse({ operationId, rendering, source, response, parameters = {} }) {
  if (typeof source !== 'string' || typeof response !== 'string') {
    throw new SemanticPromptContractError('source and response must be strings');
  }
  const selectedRendering = validationRendering({ rendering, operationId, source, parameters });
  const selectedOperationId = selectedRendering.operationId;
  const policy = selectedRendering.plainTextValidation;
  if (policy === null || policy === undefined) {
    throw new SemanticPromptContractError(`Operation does not own plain-text validation: ${selectedOperationId}`);
  }
  if (response.includes('\u0000') || response.includes('\ufffd')) {
    throw new SemanticPromptContractError('invalid_encoding');
  }

  const sourceParts = coreAndBoundaryWhitespace(source);
  const responseParts = coreAndBoundaryWhitespace(response);
  const sourceCore = sourceParts.core;
  const responseCore = responseParts.core;
  const sourceLength = [...sourceCore].length;
  const responseLength = [...responseCore].length;
  if (responseCore.length === 0) throw new SemanticPromptContractError('empty');
  if (policy.reject_unchanged
      && responseCore === sourceCore
      && sourceLength > (policy.allow_unchanged_below_source_characters ?? 0)) {
    throw new SemanticPromptContractError('unchanged');
  }

  const commonCommentaryPrefixes = [
    'here is the rewrite:', 'here is the rewritten text:', 'here is the improved text:',
    'rewritten text:', 'improved text:', 'rewrite:', 'sure,', 'certainly,', 'of course,',
    'i rewrote ', 'i have rewritten ', 'i improved ', 'i have improved ',
    'result:', 'operation result:', 'writing result:', 'response:', 'output:', 'answer:',
  ];
  const modeCommentaryPrefixes = {
    summary: ['here is the summary:', 'summary:', 'summarized text:', 'in summary:'],
    translation: ['here is the translation:', 'translation:', 'translated text:'],
    continuation: ['here is the continuation:', 'continuation:', 'continued text:'],
  };
  const commentaryPrefixes = [
    ...commonCommentaryPrefixes,
    ...(modeCommentaryPrefixes[policy.mode] ?? []),
  ];
  const commentarySuffixes = ['hope this helps.', 'let me know if you need anything else.', 'would you like another version?'];
  if (policy.reject_commentary
      && (startsWithNewSignal(responseCore, sourceCore, commentaryPrefixes)
        || endsWithNewSignal(responseCore, sourceCore, commentarySuffixes))) {
    throw new SemanticPromptContractError('commentary');
  }

  const errorPrefixes = [
    'error:', 'model error:', 'request failed:', 'internal server error', 'bad gateway',
    'service unavailable', 'upstream error', 'timeout error', 'i cannot ', "i can't ",
    'unable to ', 'i am unable to ', "i'm sorry, but i cannot ",
  ];
  if (policy.reject_raw_error_text && startsWithNewSignal(responseCore, sourceCore, errorPrefixes)) {
    throw new SemanticPromptContractError('raw_error');
  }

  if (policy.reject_json_containers && isJSONContainer(responseCore)) {
    throw new SemanticPromptContractError('json_container');
  }

  if (policy.reject_truncation_markers && hasTruncationMarker(responseCore)) {
    throw new SemanticPromptContractError('truncated');
  }

  const markdownFenceSequences = (value) => value.match(/`{3,}/gu) ?? [];
  if (policy.reject_new_markdown_fences
      && !sameSequence(markdownFenceSequences(sourceCore), markdownFenceSequences(responseCore))) {
    throw new SemanticPromptContractError('markdown_fence');
  }

  if (policy.preserve_line_breaks) {
    const lineBreakRuns = (value) => value.match(/(?:(?:\r\n|\r|\n))+/gu) ?? [];
    if (!sameSequence(lineBreakRuns(sourceCore), lineBreakRuns(responseCore))) {
      throw new SemanticPromptContractError('line_breaks');
    }
  }

  if (policy.maximum_output_characters !== undefined
      && responseLength > policy.maximum_output_characters) {
    throw new SemanticPromptContractError('unsafe_expansion');
  }
  if (policy.enforce_length_ratio
      && sourceLength >= 20
      && responseLength < Math.ceil(sourceLength * policy.minimum_length_ratio)) {
    throw new SemanticPromptContractError('truncated');
  }
  if (policy.enforce_length_ratio
      && sourceLength >= 20
      && responseLength > Math.floor(sourceLength * policy.maximum_length_ratio)) {
    throw new SemanticPromptContractError('unsafe_expansion');
  }
  if (policy.enforce_maximum_added_characters
      && responseLength - sourceLength > policy.maximum_added_characters) {
    throw new SemanticPromptContractError('unsafe_expansion');
  }
  if (policy.reject_source_fragment && responseCore !== sourceCore
      && responseLength < sourceLength
      && (sourceCore.startsWith(responseCore) || sourceCore.endsWith(responseCore))) {
    throw new SemanticPromptContractError('source_fragment');
  }
  if (policy.reject_source_repetition
      && repeatsCompleteSource(
        sourceCore,
        responseCore,
        policy.minimum_embedded_source_repetition_characters,
      )) {
    throw new SemanticPromptContractError('source_repetition');
  }

  for (const type of policy.protected_token_types) {
    if (!sameMultiset(protectedTokens(sourceCore, type), protectedTokens(responseCore, type))) {
      throw new SemanticPromptContractError(`protected_${type}`);
    }
  }
  if (policy.enforce_word_overlap
      && wordOverlapRatio(sourceCore, responseCore) < policy.minimum_word_overlap_ratio) {
    throw new SemanticPromptContractError('meaning_overlap');
  }

  if (policy.preserve_response_whitespace) return response;
  if (policy.preserve_boundary_whitespace) {
    return sourceParts.leading + responseCore + sourceParts.trailing;
  }
  return responseCore;
}

export function operationIds(packId = 'writing-actions') {
  const pack = packs.get(packId);
  if (!pack) throw new SemanticPromptContractError(`Unknown contract pack: ${packId}`);
  return pack.operations.map((operation) => operation.id);
}

export function gatewayPromptPresets() {
  return readJSON('fixtures/gateway-presets.json').map((fixture) => {
    const pack = packs.get(fixture.pack_id);
    const operation = pack.operations.find((candidate) => candidate.id === fixture.operation_id);
    const rendered = render({
      packId: fixture.pack_id,
      operationId: fixture.operation_id,
      input: fixture.input,
      parameters: fixture.parameters,
    });
    return Object.freeze({
      id: fixture.id,
      label: fixture.label,
      packId: fixture.pack_id,
      operationId: fixture.operation_id,
      input: fixture.input,
      parameters: Object.freeze({ ...fixture.parameters }),
      system: rendered.messages[0].content,
      user: rendered.messages[1].content,
      responseSchema: rendered.responseSchema,
      resultTypes: Object.freeze([...operation.result_types]),
      plainTextValidation: rendered.plainTextValidation,
      request: Object.freeze({
        operation: rendered.wireOperationId,
        input_text: fixture.input,
        ...(rendered.responseFormat === null ? {} : { response_format: rendered.responseFormat }),
        max_tokens: rendered.maxTokens,
        ...(rendered.temperature === null ? {} : { temperature: rendered.temperature }),
      }),
      contractVersion: rendered.contractVersion,
    });
  });
}
