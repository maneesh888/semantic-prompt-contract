package com.maneesh.semanticpromptcontract

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

public class SemanticPromptContractException(message: String) : IllegalArgumentException(message)

public data class SemanticPromptMessage(public val role: String, public val content: String)

public data class SemanticPlainTextValidationPolicy(
    public val mode: String,
    public val rejectUnchanged: Boolean,
    public val preserveBoundaryWhitespace: Boolean,
    public val preserveLineBreaks: Boolean,
    public val rejectNewMarkdownFences: Boolean,
    public val rejectCommentary: Boolean,
    public val rejectRawErrorText: Boolean,
    public val rejectSourceFragment: Boolean,
    public val rejectJsonContainers: Boolean,
    public val rejectTruncationMarkers: Boolean,
    public val rejectSourceRepetition: Boolean,
    public val minimumEmbeddedSourceRepetitionCharacters: Int,
    public val preserveResponseWhitespace: Boolean,
    public val enforceLengthRatio: Boolean,
    public val enforceMaximumAddedCharacters: Boolean,
    public val enforceWordOverlap: Boolean,
    public val allowUnchangedBelowSourceCharacters: Int,
    public val minimumLengthRatio: Double,
    public val maximumLengthRatio: Double,
    public val maximumAddedCharacters: Int,
    public val maximumOutputCharacters: Int,
    public val minimumWordOverlapRatio: Double,
    public val protectedTokenTypes: List<String>,
    public val requiresTargetLanguageValidation: Boolean,
)

public data class SemanticPromptRendering(
    public val contractVersion: String,
    public val schemaVersion: String,
    public val packId: String,
    public val operationId: String,
    public val wireOperationId: String?,
    public val messages: List<SemanticPromptMessage>,
    public val responseFormatType: String?,
    public val maxTokens: Int,
    public val temperature: Double?,
    public val plainTextValidationPolicy: SemanticPlainTextValidationPolicy?,
)

public data class SemanticGatewayPromptPreset(
    public val id: String,
    public val label: String,
    public val input: String,
    public val parameters: Map<String, String>,
    public val rendering: SemanticPromptRendering,
    public val responseSchema: String?,
    public val resultTypes: List<String>,
)

public object SemanticPromptContract {
    private val json = Json
    private val manifest = json.parseToJsonElement(CanonicalContractData.manifestJson).jsonObject
    private val writing = json.parseToJsonElement(CanonicalContractData.writingJson).jsonObject
    private val suggestions = json.parseToJsonElement(CanonicalContractData.suggestionsJson).jsonObject

    public val version: String = manifest.requiredString("contract_version")
    public val schemaVersion: String = manifest.requiredString("schema_version")
    public val writingOperationIds: List<String> = writing.requiredArray("operations").map {
        it.jsonObject.requiredString("id")
    }
    public val unstructuredWritingSystemInstruction: String = writing.requiredString("unstructured_system_instruction")
    public val keyboardSuggestionsSystemInstruction: String = suggestions.requiredString("system_instruction")

    public fun renderWriting(
        operationId: String,
        input: String,
        parameters: Map<String, String> = emptyMap(),
    ): SemanticPromptRendering = render(writing, "writing-actions", operationId, input, parameters)

    public fun renderKeyboardSuggestions(input: String): SemanticPromptRendering =
        render(suggestions, "keyboard-suggestions", "keyboard_suggestions", input, emptyMap())

    public fun validatePlainTextResponse(
        response: String,
        operationId: String,
        source: String,
        parameters: Map<String, String> = emptyMap(),
    ): String = SemanticPlainTextResponseValidator.validate(
        response,
        renderWriting(operationId, source, parameters),
        source,
    )

    public fun validatePlainTextResponse(
        response: String,
        rendering: SemanticPromptRendering,
        source: String,
    ): String = SemanticPlainTextResponseValidator.validate(response, rendering, source)

    public val gatewayPromptPresets: List<SemanticGatewayPromptPreset> by lazy {
        json.parseToJsonElement(CanonicalContractData.gatewayPresetsJson).jsonArray.map { element ->
            val fixture = element.jsonObject
            val packId = fixture.requiredString("pack_id")
            val operationId = fixture.requiredString("operation_id")
            val parameters = fixture.requiredObject("parameters").mapValues { it.value.jsonPrimitive.content }
            val pack = when (packId) {
                "writing-actions" -> writing
                "keyboard-suggestions" -> suggestions
                else -> throw SemanticPromptContractException("Unknown contract pack: $packId")
            }
            val operation = pack.requiredArray("operations").map(JsonElement::jsonObject)
                .firstOrNull { it.requiredString("id") == operationId }
                ?: throw SemanticPromptContractException("Unknown operation for $packId: $operationId")
            SemanticGatewayPromptPreset(
                id = fixture.requiredString("id"),
                label = fixture.requiredString("label"),
                input = fixture.requiredString("input"),
                parameters = parameters,
                rendering = render(pack, packId, operationId, fixture.requiredString("input"), parameters),
                responseSchema = operation.stringOrNull("response_schema"),
                resultTypes = operation.requiredArray("result_types").map { it.jsonPrimitive.content },
            )
        }
    }

    private fun render(
        pack: JsonObject,
        packId: String,
        operationId: String,
        input: String,
        parameters: Map<String, String>,
    ): SemanticPromptRendering {
        val operation = pack.requiredArray("operations").map(JsonElement::jsonObject)
            .firstOrNull { it.requiredString("id") == operationId }
            ?: throw SemanticPromptContractException("Unknown operation for $packId: $operationId")
        val validatedParameters = validatedParameters(operation, parameters)
        val wireOperationId = operation.stringOrNull("wire_operation_id")
        val responseFormat = operation.stringOrNull("response_format")
            ?: pack["response"]?.jsonObject?.stringOrNull("format")
        val temperature = when {
            !operation.containsKey("temperature") -> 0.1
            operation["temperature"] == JsonNull -> null
            else -> operation.getValue("temperature").jsonPrimitive.double
        }
        return SemanticPromptRendering(
            contractVersion = pack.requiredString("contract_version"),
            schemaVersion = pack.requiredString("schema_version"),
            packId = packId,
            operationId = operationId,
            wireOperationId = wireOperationId,
            messages = listOf(
                SemanticPromptMessage("system", plainTextSystemInstruction(pack, operation)),
                SemanticPromptMessage(
                    "user",
                    renderUserMessage(pack, operation, input, validatedParameters, wireOperationId),
                ),
            ),
            responseFormatType = if (responseFormat == "json_object") "json_object" else null,
            maxTokens = operation.requiredInt("max_tokens"),
            temperature = temperature,
            plainTextValidationPolicy = plainTextValidation(pack, operation),
        )
    }

    private fun renderUserMessage(
        pack: JsonObject,
        operation: JsonObject,
        input: String,
        parameters: Map<String, String>,
        wireOperationId: String?,
    ): String {
        if (operation.stringOrNull("user_message_mode") == "raw_input") return input
        val values = parameters.toMutableMap()
        wireOperationId?.let { values["operation"] = it }
        pack["response"]?.jsonObject?.stringOrNull("top_level_example")?.let {
            values["response_example"] = substitute(it, values)
        }
        val rules = operation.requiredArray("rules").map { substitute(it.jsonPrimitive.content, values) }
        values["numbered_rules"] = rules.mapIndexed { index, rule ->
            substitute(pack.requiredString("rule_line_template"), mapOf("index" to "${index + 1}", "rule" to rule))
        }.joinToString("\n")
        val maximumCharacters = pack.requiredObject("input").intOrNull("max_characters")
        val boundedInput = maximumCharacters?.let { unicodeScalarPrefix(input, it) } ?: input
        values["input_json"] = JsonPrimitive(boundedInput).toString()
        values["parameters_json"] = JsonObject(
            parameters.keys.sorted().associateWith { JsonPrimitive(parameters.getValue(it)) },
        ).toString()
        return substitute(pack.requiredString("user_message_template"), values)
    }

    private fun plainTextSystemInstruction(pack: JsonObject, operation: JsonObject): String {
        operation.stringOrNull("system_instruction")?.let { return it }
        val instruction = operation.stringOrNull("plain_text_instruction")
            ?: return pack.requiredString("system_instruction")
        return substitute(
            pack.requiredString("plain_text_system_instruction_template"),
            mapOf("plain_text_instruction" to instruction),
        )
    }

    private fun plainTextValidation(pack: JsonObject, operation: JsonObject): SemanticPlainTextValidationPolicy? {
        val profile = operation.stringOrNull("plain_text_validation_profile") ?: return null
        val policy = pack["plain_text_validation_profiles"]?.jsonObject?.get(profile)?.jsonObject
            ?: throw SemanticPromptContractException(
                "Unknown plain-text validation profile for ${operation.requiredString("id")}: $profile",
            )
        return SemanticPlainTextValidationPolicy(
            mode = policy.requiredString("mode"),
            rejectUnchanged = policy.requiredBoolean("reject_unchanged"),
            preserveBoundaryWhitespace = policy.requiredBoolean("preserve_boundary_whitespace"),
            preserveLineBreaks = policy.requiredBoolean("preserve_line_breaks"),
            rejectNewMarkdownFences = policy.requiredBoolean("reject_new_markdown_fences"),
            rejectCommentary = policy.requiredBoolean("reject_commentary"),
            rejectRawErrorText = policy.requiredBoolean("reject_raw_error_text"),
            rejectSourceFragment = policy.requiredBoolean("reject_source_fragment"),
            rejectJsonContainers = policy.requiredBoolean("reject_json_containers"),
            rejectTruncationMarkers = policy.requiredBoolean("reject_truncation_markers"),
            rejectSourceRepetition = policy.requiredBoolean("reject_source_repetition"),
            minimumEmbeddedSourceRepetitionCharacters = policy.requiredInt("minimum_embedded_source_repetition_characters"),
            preserveResponseWhitespace = policy.requiredBoolean("preserve_response_whitespace"),
            enforceLengthRatio = policy.requiredBoolean("enforce_length_ratio"),
            enforceMaximumAddedCharacters = policy.requiredBoolean("enforce_maximum_added_characters"),
            enforceWordOverlap = policy.requiredBoolean("enforce_word_overlap"),
            allowUnchangedBelowSourceCharacters = policy.requiredInt("allow_unchanged_below_source_characters"),
            minimumLengthRatio = policy.requiredDouble("minimum_length_ratio"),
            maximumLengthRatio = policy.requiredDouble("maximum_length_ratio"),
            maximumAddedCharacters = policy.requiredInt("maximum_added_characters"),
            maximumOutputCharacters = policy.requiredInt("maximum_output_characters"),
            minimumWordOverlapRatio = policy.requiredDouble("minimum_word_overlap_ratio"),
            protectedTokenTypes = policy.requiredArray("protected_token_types").map { it.jsonPrimitive.content },
            requiresTargetLanguageValidation = policy.requiredBoolean("requires_target_language_validation"),
        )
    }

    private fun validatedParameters(operation: JsonObject, supplied: Map<String, String>): Map<String, String> {
        val definitions = operation.requiredArray("parameters").map(JsonElement::jsonObject)
        val names = definitions.mapTo(mutableSetOf()) { it.requiredString("name") }
        supplied.keys.firstOrNull { it !in names }?.let {
            throw SemanticPromptContractException("Unsupported parameter for ${operation.requiredString("id")}: $it")
        }
        return buildMap {
            for (definition in definitions) {
                val name = definition.requiredString("name")
                val shouldTrim = definition.booleanOrNull("trim") == true
                val suppliedValue = supplied[name]
                var value = if (suppliedValue == null || shouldTrim && trimAsciiWhitespace(suppliedValue).isEmpty()) {
                    definition.stringOrNull("default")
                } else {
                    suppliedValue
                }
                if (value == null && definition.booleanOrNull("required") == true) {
                    throw SemanticPromptContractException("Missing required parameter for ${operation.requiredString("id")}: $name")
                }
                if (value != null && shouldTrim) value = trimAsciiWhitespace(value)
                val maximumLength = definition.intOrNull("max_length")
                if (value != null && maximumLength != null && unicodeScalarCount(value) > maximumLength) {
                    throw SemanticPromptContractException("$name exceeds maximum length $maximumLength")
                }
                val pattern = definition.stringOrNull("pattern")
                if (value != null && pattern != null && !Regex(pattern).matches(value)) {
                    throw SemanticPromptContractException("$name has an unsupported value")
                }
                value?.let { put(name, it) }
            }
        }
    }
}

internal fun trimAsciiWhitespace(value: String): String =
    value.trim { it == ' ' || it == '\t' || it == '\n' || it == '\r' || it == '\u000B' || it == '\u000C' }

internal fun unicodeScalarCount(value: String): Int {
    var count = 0
    var index = 0
    while (index < value.length) {
        val first = value[index]
        index += if (first.isHighSurrogate() && index + 1 < value.length && value[index + 1].isLowSurrogate()) 2 else 1
        count += 1
    }
    return count
}

internal fun unicodeScalarPrefix(value: String, maximumCount: Int): String {
    var count = 0
    var index = 0
    while (index < value.length && count < maximumCount) {
        val first = value[index]
        index += if (first.isHighSurrogate() && index + 1 < value.length && value[index + 1].isLowSurrogate()) 2 else 1
        count += 1
    }
    return value.substring(0, index)
}

private val placeholderRegex = Regex("\\{\\{([a-z_]+)}}")

private fun substitute(template: String, values: Map<String, String>): String = placeholderRegex.replace(template) { match ->
    values[match.groupValues[1]]
        ?: throw SemanticPromptContractException("Missing template value: ${match.groupValues[1]}")
}

private fun JsonObject.requiredString(name: String): String = getValue(name).jsonPrimitive.content
private fun JsonObject.requiredInt(name: String): Int = getValue(name).jsonPrimitive.int
private fun JsonObject.requiredDouble(name: String): Double = getValue(name).jsonPrimitive.double
private fun JsonObject.requiredBoolean(name: String): Boolean = getValue(name).jsonPrimitive.boolean
private fun JsonObject.requiredArray(name: String): JsonArray = getValue(name).jsonArray
private fun JsonObject.requiredObject(name: String): JsonObject = getValue(name).jsonObject
private fun JsonObject.stringOrNull(name: String): String? = get(name)?.takeUnless { it == JsonNull }?.jsonPrimitive?.content
private fun JsonObject.intOrNull(name: String): Int? = get(name)?.takeUnless { it == JsonNull }?.jsonPrimitive?.int
private fun JsonObject.booleanOrNull(name: String): Boolean? = get(name)?.takeUnless { it == JsonNull }?.jsonPrimitive?.boolean
