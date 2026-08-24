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
  values.response_example = substitute(pack.response.top_level_example, values);
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
  const responseFormat = operation.response_format ?? pack.response.format;
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
    responseSchema: responseFormat === 'json_object' ? pack.response.schema : null,
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
  const patterns = {
    number: /[+-]?\d+(?:[.,:/-]\d+)*/gu,
    url: /https?:\/\/[^\s<>()]+/giu,
    email: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu,
    mention: /@[\p{L}\p{N}_]+/gu,
    hashtag: /#[\p{L}\p{N}_]+/gu,
    emoji: /\p{Extended_Pictographic}/gu,
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

export function validatePlainTextResponse({ operationId, source, response }) {
  if (typeof source !== 'string' || typeof response !== 'string') {
    throw new SemanticPromptContractError('source and response must be strings');
  }
  const pack = packs.get('writing-actions');
  const operation = pack.operations.find((candidate) => candidate.id === operationId);
  if (!operation) throw new SemanticPromptContractError(`Unknown operation for writing-actions: ${operationId}`);
  const policy = plainTextValidation(pack, operation);
  if (policy === null) throw new SemanticPromptContractError(`Operation does not own complete-replacement validation: ${operationId}`);
  if (response.includes('\u0000') || response.includes('\ufffd')) {
    throw new SemanticPromptContractError('invalid_encoding');
  }

  const sourceParts = coreAndBoundaryWhitespace(source);
  const responseParts = coreAndBoundaryWhitespace(response);
  const sourceCore = sourceParts.core;
  const responseCore = responseParts.core;
  if (responseCore.length === 0) throw new SemanticPromptContractError('empty');
  if (policy.reject_unchanged && responseCore === sourceCore) throw new SemanticPromptContractError('unchanged');

  const commentaryPrefixes = [
    'here is the rewrite:', 'here is the rewritten text:', 'here is the improved text:',
    'rewritten text:', 'improved text:', 'rewrite:', 'sure,', 'certainly,', 'of course,',
    'i rewrote ', 'i have rewritten ', 'i improved ', 'i have improved ',
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

  const responseStartsFence = responseCore.startsWith('```');
  const responseEndsFence = responseCore.endsWith('```');
  const sourceStartsFence = sourceCore.startsWith('```');
  const sourceEndsFence = sourceCore.endsWith('```');
  if (policy.reject_new_markdown_fences
      && ((responseStartsFence && !sourceStartsFence) || (responseEndsFence && !sourceEndsFence))) {
    throw new SemanticPromptContractError('markdown_fence');
  }

  if (policy.preserve_line_breaks) {
    const lineBreaks = (value) => value.match(/\r\n|\r|\n/gu) ?? [];
    if (!sameMultiset(lineBreaks(sourceCore), lineBreaks(responseCore))) {
      throw new SemanticPromptContractError('line_breaks');
    }
  }

  const sourceLength = [...sourceCore].length;
  const responseLength = [...responseCore].length;
  if (sourceLength >= 20 && responseLength < Math.ceil(sourceLength * policy.minimum_length_ratio)) {
    throw new SemanticPromptContractError('truncated');
  }
  if (sourceLength >= 20 && responseLength > Math.floor(sourceLength * policy.maximum_length_ratio)) {
    throw new SemanticPromptContractError('unsafe_expansion');
  }
  if (responseLength - sourceLength > policy.maximum_added_characters) {
    throw new SemanticPromptContractError('unsafe_expansion');
  }
  if (policy.reject_source_fragment && responseCore !== sourceCore
      && responseCore.length < sourceCore.length
      && (sourceCore.startsWith(responseCore) || sourceCore.endsWith(responseCore))) {
    throw new SemanticPromptContractError('source_fragment');
  }

  for (const type of policy.protected_token_types) {
    if (!sameMultiset(protectedTokens(sourceCore, type), protectedTokens(responseCore, type))) {
      throw new SemanticPromptContractError(`protected_${type}`);
    }
  }
  if (wordOverlapRatio(sourceCore, responseCore) < policy.minimum_word_overlap_ratio) {
    throw new SemanticPromptContractError('meaning_overlap');
  }

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
        response_format: rendered.responseFormat,
        max_tokens: rendered.maxTokens,
        ...(rendered.temperature === null ? {} : { temperature: rendered.temperature }),
      }),
      contractVersion: rendered.contractVersion,
    });
  });
}
