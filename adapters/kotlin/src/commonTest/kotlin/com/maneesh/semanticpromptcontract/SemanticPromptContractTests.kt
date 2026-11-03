package com.maneesh.semanticpromptcontract

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

internal data class SemanticPromptParityFixture(
    val caseId: String,
    val packId: String,
    val operationId: String,
    val input: String,
    val parameters: Map<String, String>,
    val expectedUserMessage: String,
)

internal data class SemanticPlainTextValidationFixture(
    val caseId: String,
    val operationId: String,
    val source: String,
    val response: String,
    val valid: Boolean,
    val expected: String?,
    val expectedError: String?,
)

class SemanticPromptContractTests {
    @Test
    fun generatedJavaScriptGoldenMessagesMatchKotlinByteForByte() {
        for (fixture in semanticPromptParityFixtures) {
            val rendering = if (fixture.packId == "keyboard-suggestions") {
                SemanticPromptContract.renderKeyboardSuggestions(fixture.input)
            } else {
                SemanticPromptContract.renderWriting(fixture.operationId, fixture.input, fixture.parameters)
            }
            assertEquals(fixture.expectedUserMessage, rendering.messages.last().content, fixture.caseId)
        }
    }

    @Test
    fun operationSpecificValidationMatchesCanonicalFixtures() {
        for (fixture in semanticPlainTextValidationFixtures) {
            if (fixture.valid) {
                assertEquals(
                    fixture.expected,
                    SemanticPromptContract.validatePlainTextResponse(
                        response = fixture.response,
                        operationId = fixture.operationId,
                        source = fixture.source,
                    ),
                    fixture.caseId,
                )
            } else {
                val failure = assertFailsWith<SemanticPromptContractException>(fixture.caseId) {
                    SemanticPromptContract.validatePlainTextResponse(
                        response = fixture.response,
                        operationId = fixture.operationId,
                        source = fixture.source,
                    )
                }
                assertEquals(fixture.expectedError, failure.message, fixture.caseId)
            }
        }
    }

    @Test
    fun everyWritingOperationRendersStableMetadata() {
        assertEquals("5.1.0", SemanticPromptContract.version)
        assertEquals("3.0.0", SemanticPromptContract.schemaVersion)
        for (operationId in SemanticPromptContract.writingOperationIds) {
            val parameters = if (operationId == "translate") mapOf("target_language" to "Dutch") else emptyMap()
            val rendering = SemanticPromptContract.renderWriting(operationId, "Hello 👋\n```json\n{}", parameters)
            assertEquals(listOf("system", "user"), rendering.messages.map { it.role })
            assertNull(rendering.responseFormatType)
            if (operationId == "fix_grammar") {
                assertEquals(0.0, rendering.temperature)
                assertNull(rendering.plainTextValidationPolicy)
            } else {
                assertEquals(0.1, rendering.temperature)
                assertTrue(rendering.plainTextValidationPolicy != null)
            }
        }
    }

    @Test
    fun parametersAndUnicodeScalarBoundsMatchCanonicalBehavior() {
        val translated = SemanticPromptContract.renderWriting(
            operationId = "translate",
            input = "Hello",
            parameters = mapOf("target_language" to " Dutch "),
        )
        assertTrue(translated.messages.last().content.contains("\"target_language\":\"Dutch\""))
        assertFailsWith<SemanticPromptContractException> {
            SemanticPromptContract.renderWriting("translate", "Hello", mapOf("target_language" to "A\u0301".repeat(41)))
        }
        assertFailsWith<SemanticPromptContractException> {
            SemanticPromptContract.renderWriting("summarize", "Hello", mapOf("tone" to "formal"))
        }
        val family = "👨‍👩‍👧‍👦"
        val bounded = SemanticPromptContract.renderKeyboardSuggestions(family.repeat(501)).messages.last().content
        assertTrue(bounded.contains(JsonProbe.stringLiteral(unicodeScalarPrefix(family.repeat(501), 500))))
    }

    @Test
    fun gatewayPresetsRetainCanonicalOrderAndRenderings() {
        val presets = SemanticPromptContract.gatewayPromptPresets
        assertEquals(7, presets.size)
        assertEquals("plain-grammar-fast", presets.first().id)
        assertEquals("structured-operation-translate-dutch", presets.last().id)
        assertTrue(presets.all { it.rendering.contractVersion == SemanticPromptContract.version })
    }
}

private object JsonProbe {
    fun stringLiteral(value: String): String = buildString {
        append('"')
        for (character in value) {
            when (character) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> append(character)
            }
        }
        append('"')
    }
}
