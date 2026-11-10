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
        "emoji" -> emojiGraphemeTokens(value)
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

    private fun emojiGraphemeTokens(value: String): List<String> {
        val scalars = scalarStrings(value)
        return buildList {
            var index = 0
            while (index < scalars.size) {
                val codePoint = codePoint(scalars[index])
                if (codePoint.isRegionalIndicator()) {
                    val end = if (index + 1 < scalars.size && codePoint(scalars[index + 1]).isRegionalIndicator()) {
                        index + 2
                    } else {
                        index + 1
                    }
                    add(scalars.subList(index, end).joinToString(""))
                    index = end
                    continue
                }
                if (!codePoint.isEmojiPresentation()) {
                    index += 1
                    continue
                }

                val start = index
                index = consumeEmojiExtensions(scalars, index + 1)
                while (index + 1 < scalars.size && codePoint(scalars[index]) == 0x200D &&
                    codePoint(scalars[index + 1]).isEmojiJoinTarget()
                ) {
                    index = consumeEmojiExtensions(scalars, index + 2)
                }
                add(scalars.subList(start, index).joinToString(""))
            }
        }
    }

    private fun consumeEmojiExtensions(scalars: List<String>, start: Int): Int {
        var index = start
        while (index < scalars.size && codePoint(scalars[index]).isEmojiExtension()) index += 1
        return index
    }

    private fun codePoint(value: String): Int =
        if (value.length == 2 && value[0].isHighSurrogate() && value[1].isLowSurrogate()) {
            0x10000 + ((value[0].code - 0xD800) shl 10) + (value[1].code - 0xDC00)
        } else {
            value.first().code
        }

    private fun Int.isRegionalIndicator(): Boolean = this in 0x1F1E6..0x1F1FF

    private fun Int.isEmojiExtension(): Boolean =
        this in 0xFE00..0xFE0F || this in 0xE0100..0xE01EF ||
            this in 0x1F3FB..0x1F3FF || this in 0xE0020..0xE007F || this == 0x20E3

    private fun Int.isEmojiJoinTarget(): Boolean =
        isEmojiPresentation() || this in 0x2300..0x23FF || this in 0x2600..0x27BF ||
            this in 0x1F000..0x1FAFF

    private fun Int.isEmojiPresentation(): Boolean {
        var rangeIndex = 0
        while (rangeIndex < emojiPresentationRanges.size) {
            val lower = emojiPresentationRanges[rangeIndex]
            if (this < lower) return false
            if (this <= emojiPresentationRanges[rangeIndex + 1]) return true
            rangeIndex += 2
        }
        return false
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
    private val url = Regex(
        "https?://[^\\u0009-\\u000D\\u0020\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF<>()]+",
        RegexOption.IGNORE_CASE,
    )
    private val email = Regex("[\\p{L}\\p{N}._%+-]+@[\\p{L}\\p{N}.-]+\\.[\\p{L}]{2,}", RegexOption.IGNORE_CASE)
    private val mention = Regex("@[\\p{L}\\p{N}_]+")
    private val hashtag = Regex("#[\\p{L}\\p{N}_]+")
    private val markdownLink = Regex("]\\(([^)]+)\\)")

    // Unicode 17.0 Emoji_Presentation ranges used by the JavaScript and Swift validators.
    private val emojiPresentationRanges = intArrayOf(
        0x231A, 0x231B, 0x23E9, 0x23EC, 0x23F0, 0x23F0, 0x23F3, 0x23F3,
        0x25FD, 0x25FE, 0x2614, 0x2615, 0x2648, 0x2653, 0x267F, 0x267F,
        0x2693, 0x2693, 0x26A1, 0x26A1, 0x26AA, 0x26AB, 0x26BD, 0x26BE,
        0x26C4, 0x26C5, 0x26CE, 0x26CE, 0x26D4, 0x26D4, 0x26EA, 0x26EA,
        0x26F2, 0x26F3, 0x26F5, 0x26F5, 0x26FA, 0x26FA, 0x26FD, 0x26FD,
        0x2705, 0x2705, 0x270A, 0x270B, 0x2728, 0x2728, 0x274C, 0x274C,
        0x274E, 0x274E, 0x2753, 0x2755, 0x2757, 0x2757, 0x2795, 0x2797,
        0x27B0, 0x27B0, 0x27BF, 0x27BF, 0x2B1B, 0x2B1C, 0x2B50, 0x2B50,
        0x2B55, 0x2B55, 0x1F004, 0x1F004, 0x1F0CF, 0x1F0CF, 0x1F18E, 0x1F18E,
        0x1F191, 0x1F19A, 0x1F1E6, 0x1F1FF, 0x1F201, 0x1F201, 0x1F21A, 0x1F21A,
        0x1F22F, 0x1F22F, 0x1F232, 0x1F236, 0x1F238, 0x1F23A, 0x1F250, 0x1F251,
        0x1F300, 0x1F320, 0x1F32D, 0x1F335, 0x1F337, 0x1F37C, 0x1F37E, 0x1F393,
        0x1F3A0, 0x1F3CA, 0x1F3CF, 0x1F3D3, 0x1F3E0, 0x1F3F0, 0x1F3F4, 0x1F3F4,
        0x1F3F8, 0x1F43E, 0x1F440, 0x1F440, 0x1F442, 0x1F4FC, 0x1F4FF, 0x1F53D,
        0x1F54B, 0x1F54E, 0x1F550, 0x1F567, 0x1F57A, 0x1F57A, 0x1F595, 0x1F596,
        0x1F5A4, 0x1F5A4, 0x1F5FB, 0x1F64F, 0x1F680, 0x1F6C5, 0x1F6CC, 0x1F6CC,
        0x1F6D0, 0x1F6D2, 0x1F6D5, 0x1F6D8, 0x1F6DC, 0x1F6DF, 0x1F6EB, 0x1F6EC,
        0x1F6F4, 0x1F6FC, 0x1F7E0, 0x1F7EB, 0x1F7F0, 0x1F7F0, 0x1F90C, 0x1F93A,
        0x1F93C, 0x1F945, 0x1F947, 0x1F9FF, 0x1FA70, 0x1FA7C, 0x1FA80, 0x1FA8A,
        0x1FA8E, 0x1FAC6, 0x1FAC8, 0x1FAC8, 0x1FACD, 0x1FADC, 0x1FADF, 0x1FAEA,
        0x1FAEF, 0x1FAF8,
    )
}

internal expect fun normalizedCompatibility(value: String): String
