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

export function render({ packId = 'writing-actions', operationId, input, parameters = {} }) {
  if (typeof input !== 'string') throw new SemanticPromptContractError('input must be a string');
  const pack = packs.get(packId);
  if (!pack) throw new SemanticPromptContractError(`Unknown contract pack: ${packId}`);
  const operation = pack.operations.find((candidate) => candidate.id === operationId);
  if (!operation) throw new SemanticPromptContractError(`Unknown operation for ${packId}: ${operationId}`);
  const user = renderUserMessage(pack, operation, input, parameters);
  const responseFormat = operation.response_format ?? pack.response.format;
  return Object.freeze({
    contractVersion: pack.contract_version,
    schemaVersion: pack.schema_version,
    packId,
    operationId: operation.id,
    wireOperationId: operation.wire_operation_id,
    messages: Object.freeze([
      Object.freeze({ role: 'system', content: operation.system_instruction ?? pack.system_instruction }),
      Object.freeze({ role: 'user', content: user }),
    ]),
    responseFormat: responseFormat === 'json_object' ? Object.freeze({ type: 'json_object' }) : null,
    responseSchema: responseFormat === 'json_object' ? pack.response.schema : null,
    maxTokens: operation.max_tokens,
    temperature: Object.hasOwn(operation, 'temperature') ? operation.temperature : 0.1,
  });
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
