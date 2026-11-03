package com.maneesh.semanticpromptcontract

import kotlin.math.ceil
import kotlin.math.floor

internal object SemanticPlainTextResponseValidator {
    fun validate(response: String, rendering: SemanticPromptRendering, source: String): String {
        if (rendering.packId != "writing-actions") {
            throw SemanticPromptContractException("Operation does not own plain-text validation: ${rendering.operationId}")
        }
        val policy = rendering.plainTextValidationPolicy
            ?: throw SemanticPromptContractException("Operation does not own plain-text validation: ${rendering.operationId}")
        if ('\u0000' in response || '\uFFFD' in response) fail("invalid_encoding")

        val sourceParts = boundaryParts(source)
        val responseParts = boundaryParts(response)
        val sourceCore = sourceParts.core
        val responseCore = responseParts.core
        val sourceLength = unicodeScalarCount(sourceCore)
        val responseLength = unicodeScalarCount(responseCore)
        if (responseCore.isEmpty()) fail("empty")
        if (policy.rejectUnchanged && responseCore == sourceCore &&
            sourceLength > policy.allowUnchangedBelowSourceCharacters
        ) {
            fail("unchanged")
        }

        val commonCommentaryPrefixes = listOf(
            "here is the rewrite:", "here is the rewritten text:", "here is the improved text:",
            "rewritten text:", "improved text:", "rewrite:", "sure,", "certainly,", "of course,",
            "i rewrote ", "i have rewritten ", "i improved ", "i have improved ",
            "result:", "operation result:", "writing result:", "response:", "output:", "answer:",
        )
        val modeCommentaryPrefixes = mapOf(
            "summary" to listOf("here is the summary:", "summary:", "summarized text:", "in summary:"),
            "translation" to listOf("here is the translation:", "translation:", "translated text:"),
            "continuation" to listOf("here is the continuation:", "continuation:", "continued text:"),
        )
        val commentarySuffixes = listOf(
            "hope this helps.",
            "let me know if you need anything else.",
            "would you like another version?",
        )
        if (policy.rejectCommentary &&
            (startsWithNewSignal(responseCore, sourceCore, commonCommentaryPrefixes + modeCommentaryPrefixes.orEmpty(policy.mode)) ||
                endsWithNewSignal(responseCore, sourceCore, commentarySuffixes))
        ) {
            fail("commentary")
        }

        val errorPrefixes = listOf(
            "error:", "model error:", "request failed:", "internal server error", "bad gateway",
            "service unavailable", "upstream error", "timeout error", "i cannot ", "i can't ",
            "unable to ", "i am unable to ", "i'm sorry, but i cannot ",
        )
        if (policy.rejectRawErrorText && startsWithNewSignal(responseCore, sourceCore, errorPrefixes)) {
            fail("raw_error")
        }
        if (policy.rejectJsonContainers && (responseCore.startsWith('{') || responseCore.startsWith('['))) {
            fail("json_container")
        }
        if (policy.rejectTruncationMarkers && truncationMarker.containsMatchIn(responseCore)) fail("truncated")

        if (policy.rejectNewMarkdownFences &&
            markdownFences.findAll(sourceCore).map { it.value }.toList() !=
            markdownFences.findAll(responseCore).map { it.value }.toList()
        ) {
            fail("markdown_fence")
        }
        if (policy.preserveLineBreaks &&
            lineBreakRuns.findAll(sourceCore).map { it.value }.toList() !=
            lineBreakRuns.findAll(responseCore).map { it.value }.toList()
        ) {
            fail("line_breaks")
        }

        if (responseLength > policy.maximumOutputCharacters) fail("unsafe_expansion")
        if (policy.enforceLengthRatio && sourceLength >= 20 &&
            responseLength < ceil(sourceLength * policy.minimumLengthRatio).toInt()
        ) {
            fail("truncated")
        }
        if (policy.enforceLengthRatio && sourceLength >= 20 &&
            responseLength > floor(sourceLength * policy.maximumLengthRatio).toInt()
        ) {
            fail("unsafe_expansion")
        }
        if (policy.enforceMaximumAddedCharacters &&
            responseLength - sourceLength > policy.maximumAddedCharacters
        ) {
            fail("unsafe_expansion")
        }
        if (policy.rejectSourceFragment && responseCore != sourceCore && responseLength < sourceLength &&
            (sourceCore.startsWith(responseCore) || sourceCore.endsWith(responseCore))
        ) {
            fail("source_fragment")
        }
        if (policy.rejectSourceRepetition && repeatsCompleteSource(
                sourceCore,
                responseCore,
                policy.minimumEmbeddedSourceRepetitionCharacters,
            )
        ) {
            fail("source_repetition")
        }

        for (type in policy.protectedTokenTypes) {
            if (multiset(protectedTokens(sourceCore, type)) != multiset(protectedTokens(responseCore, type))) {
                fail("protected_$type")
            }
        }
        if (policy.enforceWordOverlap &&
            wordOverlapRatio(sourceCore, responseCore) < policy.minimumWordOverlapRatio
        ) {
            fail("meaning_overlap")
        }

        return when {
            policy.preserveResponseWhitespace -> response
            policy.preserveBoundaryWhitespace -> sourceParts.leading + responseCore + sourceParts.trailing
            else -> responseCore
        }
    }

    private fun fail(code: String): Nothing = throw SemanticPromptContractException(code)

    private data class BoundaryParts(val leading: String, val core: String, val trailing: String)

    private fun boundaryParts(value: String): BoundaryParts {
        var lower = 0
        while (lower < value.length && value[lower].isAsciiBoundaryWhitespace()) lower += 1
        var upper = value.length
        while (upper > lower && value[upper - 1].isAsciiBoundaryWhitespace()) upper -= 1
        return BoundaryParts(value.substring(0, lower), value.substring(lower, upper), value.substring(upper))
    }

    private fun Char.isAsciiBoundaryWhitespace(): Boolean =
        this == ' ' || this == '\t' || this == '\n' || this == '\r' || this == '\u000B' || this == '\u000C'

    private fun startsWithNewSignal(value: String, source: String, signals: List<String>): Boolean {
        val inspected = value.lowercase()
        val sourceInspected = source.lowercase()
        return signals.any { inspected.startsWith(it) && !sourceInspected.startsWith(it) }
    }

    private fun endsWithNewSignal(value: String, source: String, signals: List<String>): Boolean {
        val inspected = value.lowercase()
        val sourceInspected = source.lowercase()
        return signals.any { inspected.endsWith(it) && !sourceInspected.endsWith(it) }
    }

    private fun Map<String, List<String>>.orEmpty(key: String): List<String> = get(key) ?: emptyList()

    private fun repeatsCompleteSource(source: String, response: String, minimumEmbeddedCharacters: Int): Boolean {
        val normalizedSource = normalizedRepetitionText(source)
        val normalizedResponse = normalizedRepetitionText(response)
        if (normalizedSource.isEmpty()) return false
        if (normalizedResponse == normalizedSource) return true
        if (unicodeScalarCount(normalizedSource) < minimumEmbeddedCharacters) return false
        return containsAtWordBoundaries(normalizedResponse, normalizedSource)
    }

    private fun normalizedRepetitionText(value: String): String = trimAsciiWhitespace(
        asciiWhitespaceRuns.replace(normalizedCompatibility(value).lowercase(), " "),
    )

    private fun containsAtWordBoundaries(response: String, source: String): Boolean {
        val responseScalars = scalarStrings(response)
        val sourceScalars = scalarStrings(source)
        if (sourceScalars.isEmpty() || sourceScalars.size > responseScalars.size) return false
        for (start in 0..responseScalars.size - sourceScalars.size) {
            if (sourceScalars.indices.any { responseScalars[start + it] != sourceScalars[it] }) continue
            val end = start + sourceScalars.size
            val leftBoundary = !isWordScalar(sourceScalars.first()) || start == 0 ||
                !isWordScalar(responseScalars[start - 1])
            val rightBoundary = !isWordScalar(sourceScalars.last()) || end == responseScalars.size ||
                !isWordScalar(responseScalars[end])
            if (leftBoundary && rightBoundary) return true
        }
        return false
    }

    private fun isWordScalar(value: String): Boolean = wordScalar.matches(value)

    private fun protectedTokens(value: String, type: String): List<String> = when (type) {
        "number" -> number.findAll(value).map { it.value }.toList()
        "url" -> url.findAll(value).map { it.value }.toList()
        "email" -> email.findAll(value).map { it.value }.toList()
        "mention" -> mention.findAll(value).map { it.value }.toList()
        "hashtag" -> hashtag.findAll(value).map { it.value }.toList()
        "markdown_link_destination" -> markdownLink.findAll(value).map { it.groupValues[1] }.toList()
        "emoji" -> scalarStrings(value).filter(::isEmojiScalar)
        else -> throw SemanticPromptContractException("Unsupported protected token type: $type")
    }

    private fun multiset(values: List<String>): Map<String, Int> = values.groupingBy { it }.eachCount()

    private fun wordOverlapRatio(source: String, replacement: String): Double {
        val sourceWords = words.findAll(source.lowercase()).map { it.value }.toSet()
        if (sourceWords.size < 4) return 1.0
        val replacementWords = words.findAll(replacement.lowercase()).map { it.value }.toSet()
        return sourceWords.count { it in replacementWords }.toDouble() / sourceWords.size
    }

    private fun scalarStrings(value: String): List<String> = buildList {
        var index = 0
        while (index < value.length) {
            val start = index
            val first = value[index]
            index += if (first.isHighSurrogate() && index + 1 < value.length && value[index + 1].isLowSurrogate()) 2 else 1
            add(value.substring(start, index))
        }
    }

    private fun isEmojiScalar(value: String): Boolean {
        val codePoint = if (value.length == 2 && value[0].isHighSurrogate() && value[1].isLowSurrogate()) {
            0x10000 + ((value[0].code - 0xD800) shl 10) + (value[1].code - 0xDC00)
        } else {
            value.first().code
        }
        return codePoint in 0x1F000..0x1FAFF ||
            codePoint in 0x2600..0x27BF ||
            codePoint in 0x2300..0x23FF
    }

    private val truncationMarker = Regex(
        "(?:^|\\s)(?:\\[(?:output\\s+)?truncated]|<(?:output\\s+)?truncated>|\\[incomplete])$",
        RegexOption.IGNORE_CASE,
    )
    private val markdownFences = Regex("`{3,}")
    private val lineBreakRuns = Regex("(?:(?:\\r\\n|\\r|\\n))+")
    private val asciiWhitespaceRuns = Regex("[\\u0009-\\u000d\\u0020]+")
    private val wordScalar = Regex("[\\p{L}\\p{M}\\p{N}]")
    private val words = Regex("[\\p{L}\\p{M}\\p{N}]+")
    private val number = Regex("[+-]?\\d+(?:[.,:/-]\\d+)*")
    private val url = Regex("https?://[^\\s<>()]+", RegexOption.IGNORE_CASE)
    private val email = Regex("[\\p{L}\\p{N}._%+-]+@[\\p{L}\\p{N}.-]+\\.[\\p{L}]{2,}", RegexOption.IGNORE_CASE)
    private val mention = Regex("@[\\p{L}\\p{N}_]+")
    private val hashtag = Regex("#[\\p{L}\\p{N}_]+")
    private val markdownLink = Regex("]\\(([^)]+)\\)")
}

internal expect fun normalizedCompatibility(value: String): String
