import Foundation

public enum SemanticPlainTextValidationError: Error, Equatable, Sendable {
    case unsupportedOperation(String)
    case invalidEncoding
    case empty
    case unchanged
    case commentary
    case rawError
    case jsonContainer
    case markdownFence
    case lineBreaks
    case truncated
    case unsafeExpansion
    case sourceFragment
    case sourceRepetition
    case protectedToken(String)
    case meaningOverlap
}

public extension SemanticPromptContract {
    static func validatePlainTextResponse(
        _ response: String,
        operationID: String,
        source: String
    ) throws -> String {
        let rendering = try renderWriting(operationID: operationID, input: source)
        return try validatePlainTextResponse(response, rendering: rendering, source: source)
    }

    static func validatePlainTextResponse(
        _ response: String,
        rendering: SemanticPromptRendering,
        source: String
    ) throws -> String {
        guard rendering.packID == "writing-actions" else {
            throw SemanticPlainTextValidationError.unsupportedOperation(rendering.operationID)
        }
        guard let policy = rendering.plainTextValidationPolicy else {
            throw SemanticPlainTextValidationError.unsupportedOperation(rendering.operationID)
        }
        guard !response.unicodeScalars.contains(where: { $0.value == 0 || $0.value == 0xFFFD }) else {
            throw SemanticPlainTextValidationError.invalidEncoding
        }

        let sourceParts = boundaryParts(source)
        let responseParts = boundaryParts(response)
        let sourceCore = sourceParts.core
        let responseCore = responseParts.core
        let sourceLength = sourceCore.unicodeScalars.count
        let responseLength = responseCore.unicodeScalars.count
        guard !responseCore.isEmpty else { throw SemanticPlainTextValidationError.empty }
        guard !policy.rejectUnchanged
                || responseCore != sourceCore
                || sourceLength <= policy.allowUnchangedBelowSourceCharacters else {
            throw SemanticPlainTextValidationError.unchanged
        }

        let commonCommentaryPrefixes = [
            "here is the rewrite:", "here is the rewritten text:", "here is the improved text:",
            "rewritten text:", "improved text:", "rewrite:", "sure,", "certainly,", "of course,",
            "i rewrote ", "i have rewritten ", "i improved ", "i have improved ",
            "result:", "operation result:", "writing result:", "response:", "output:", "answer:",
        ]
        let modeCommentaryPrefixes: [String: [String]] = [
            "summary": ["here is the summary:", "summary:", "summarized text:", "in summary:"],
            "translation": ["here is the translation:", "translation:", "translated text:"],
            "continuation": ["here is the continuation:", "continuation:", "continued text:"],
        ]
        let commentaryPrefixes = commonCommentaryPrefixes + (modeCommentaryPrefixes[policy.mode] ?? [])
        let commentarySuffixes = [
            "hope this helps.", "let me know if you need anything else.", "would you like another version?",
        ]
        if policy.rejectCommentary,
           startsWithNewSignal(responseCore, source: sourceCore, signals: commentaryPrefixes)
            || endsWithNewSignal(responseCore, source: sourceCore, signals: commentarySuffixes) {
            throw SemanticPlainTextValidationError.commentary
        }

        let errorPrefixes = [
            "error:", "model error:", "request failed:", "internal server error", "bad gateway",
            "service unavailable", "upstream error", "timeout error", "i cannot ", "i can't ",
            "unable to ", "i am unable to ", "i'm sorry, but i cannot ",
        ]
        if policy.rejectRawErrorText,
           startsWithNewSignal(responseCore, source: sourceCore, signals: errorPrefixes) {
            throw SemanticPlainTextValidationError.rawError
        }

        if policy.rejectJSONContainers,
           responseCore.hasPrefix("{") || responseCore.hasPrefix("[") {
            throw SemanticPlainTextValidationError.jsonContainer
        }

        if policy.rejectTruncationMarkers,
           !regexMatches(#"(?:^|\s)(?:\[(?:output\s+)?truncated\]|<(?:output\s+)?truncated>|\[incomplete\])$"#, in: responseCore, caseInsensitive: true).isEmpty {
            throw SemanticPlainTextValidationError.truncated
        }

        if policy.rejectNewMarkdownFences {
            let sourceFences = regexMatches(#"`{3,}"#, in: sourceCore)
            let responseFences = regexMatches(#"`{3,}"#, in: responseCore)
            guard sourceFences == responseFences else {
                throw SemanticPlainTextValidationError.markdownFence
            }
        }

        if policy.preserveLineBreaks,
           regexMatches(#"(?:(?:\r\n|\r|\n))+"#, in: sourceCore)
            != regexMatches(#"(?:(?:\r\n|\r|\n))+"#, in: responseCore) {
            throw SemanticPlainTextValidationError.lineBreaks
        }

        if responseLength > policy.maximumOutputCharacters {
            throw SemanticPlainTextValidationError.unsafeExpansion
        }
        if policy.enforceLengthRatio,
           sourceLength >= 20,
           Double(responseLength) < ceil(Double(sourceLength) * policy.minimumLengthRatio) {
            throw SemanticPlainTextValidationError.truncated
        }
        if policy.enforceLengthRatio,
           sourceLength >= 20,
           Double(responseLength) > floor(Double(sourceLength) * policy.maximumLengthRatio) {
            throw SemanticPlainTextValidationError.unsafeExpansion
        }
        if policy.enforceMaximumAddedCharacters,
           responseLength - sourceLength > policy.maximumAddedCharacters {
            throw SemanticPlainTextValidationError.unsafeExpansion
        }
        if policy.rejectSourceFragment,
           responseCore != sourceCore,
           responseLength < sourceLength,
           sourceCore.hasPrefix(responseCore) || sourceCore.hasSuffix(responseCore) {
            throw SemanticPlainTextValidationError.sourceFragment
        }
        if policy.rejectSourceRepetition,
           repeatsCompleteSource(
               sourceCore,
               response: responseCore,
               minimumEmbeddedCharacters: policy.minimumEmbeddedSourceRepetitionCharacters
           ) {
            throw SemanticPlainTextValidationError.sourceRepetition
        }

        for type in policy.protectedTokenTypes {
            guard multiset(protectedTokens(in: sourceCore, type: type))
                    == multiset(protectedTokens(in: responseCore, type: type)) else {
                throw SemanticPlainTextValidationError.protectedToken(type)
            }
        }
        guard !policy.enforceWordOverlap
                || wordOverlapRatio(sourceCore, responseCore) >= policy.minimumWordOverlapRatio else {
            throw SemanticPlainTextValidationError.meaningOverlap
        }

        if policy.preserveResponseWhitespace {
            return response
        }
        if policy.preserveBoundaryWhitespace {
            return sourceParts.leading + responseCore + sourceParts.trailing
        }
        return responseCore
    }

    private struct BoundaryParts {
        let leading: String
        let core: String
        let trailing: String
    }

    private static func boundaryParts(_ value: String) -> BoundaryParts {
        let whitespace = CharacterSet(charactersIn: " \t\n\r\u{000B}\u{000C}")
        let scalars = value.unicodeScalars
        var lower = scalars.startIndex
        while lower < scalars.endIndex, whitespace.contains(scalars[lower]) {
            lower = scalars.index(after: lower)
        }
        var upper = scalars.endIndex
        while upper > lower {
            let previous = scalars.index(before: upper)
            guard whitespace.contains(scalars[previous]) else { break }
            upper = previous
        }
        return BoundaryParts(
            leading: String(scalars[..<lower]),
            core: String(scalars[lower..<upper]),
            trailing: String(scalars[upper..<scalars.endIndex])
        )
    }

    private static func startsWithNewSignal(_ value: String, source: String, signals: [String]) -> Bool {
        let inspected = value.lowercased()
        let sourceInspected = source.lowercased()
        return signals.contains { inspected.hasPrefix($0) && !sourceInspected.hasPrefix($0) }
    }

    private static func endsWithNewSignal(_ value: String, source: String, signals: [String]) -> Bool {
        let inspected = value.lowercased()
        let sourceInspected = source.lowercased()
        return signals.contains { inspected.hasSuffix($0) && !sourceInspected.hasSuffix($0) }
    }

    private static func repeatsCompleteSource(
        _ source: String,
        response: String,
        minimumEmbeddedCharacters: Int
    ) -> Bool {
        let normalizedSource = normalizedRepetitionText(source)
        let normalizedResponse = normalizedRepetitionText(response)
        guard !normalizedSource.isEmpty else { return false }
        if normalizedResponse == normalizedSource { return true }
        guard normalizedSource.unicodeScalars.count >= minimumEmbeddedCharacters else { return false }
        return containsAtWordBoundaries(normalizedResponse, source: normalizedSource)
    }

    private static func normalizedRepetitionText(_ value: String) -> String {
        value
            .precomposedStringWithCompatibilityMapping
            .lowercased()
            .replacingOccurrences(
                of: #"[\x{0009}-\x{000D}\x{0020}]+"#,
                with: " ",
                options: .regularExpression
            )
            .trimmingCharacters(in: CharacterSet(charactersIn: " \t\n\r\u{000B}\u{000C}"))
    }

    private static func containsAtWordBoundaries(_ response: String, source: String) -> Bool {
        let responseScalars = Array(response.unicodeScalars)
        let sourceScalars = Array(source.unicodeScalars)
        guard !sourceScalars.isEmpty, sourceScalars.count <= responseScalars.count else { return false }
        for start in 0...(responseScalars.count - sourceScalars.count) {
            guard sourceScalars.indices.allSatisfy({ offset in
                responseScalars[start + offset] == sourceScalars[offset]
            }) else { continue }
            let end = start + sourceScalars.count
            let leftBoundary = !isWordScalar(sourceScalars[0])
                || start == 0
                || !isWordScalar(responseScalars[start - 1])
            let rightBoundary = !isWordScalar(sourceScalars[sourceScalars.count - 1])
                || end == responseScalars.count
                || !isWordScalar(responseScalars[end])
            if leftBoundary && rightBoundary { return true }
        }
        return false
    }

    private static func isWordScalar(_ scalar: Unicode.Scalar) -> Bool {
        CharacterSet.alphanumerics.contains(scalar) || CharacterSet.nonBaseCharacters.contains(scalar)
    }

    private static func protectedTokens(in value: String, type: String) -> [String] {
        switch type {
        case "number":
            return regexMatches(#"[+-]?\d+(?:[.,:/-]\d+)*"#, in: value)
        case "url":
            return regexMatches(#"https?://[^\s<>()]+"#, in: value, caseInsensitive: true)
        case "email":
            return regexMatches(#"[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}"#, in: value, caseInsensitive: true)
        case "mention":
            return regexMatches(#"@[\p{L}\p{N}_]+"#, in: value)
        case "hashtag":
            return regexMatches(#"#[\p{L}\p{N}_]+"#, in: value)
        case "emoji":
            return value.map(String.init).filter { character in
                character.unicodeScalars.contains { $0.properties.isEmojiPresentation }
            }
        case "markdown_link_destination":
            return regexCaptureMatches(#"\]\(([^)]+)\)"#, in: value)
        default:
            return []
        }
    }

    private static func wordOverlapRatio(_ source: String, _ response: String) -> Double {
        let sourceWords = Set(regexMatches(#"[\p{L}\p{M}\p{N}]+"#, in: source.lowercased()))
        guard sourceWords.count >= 4 else { return 1 }
        let responseWords = Set(regexMatches(#"[\p{L}\p{M}\p{N}]+"#, in: response.lowercased()))
        return Double(sourceWords.intersection(responseWords).count) / Double(sourceWords.count)
    }

    private static func multiset(_ values: [String]) -> [String: Int] {
        values.reduce(into: [:]) { result, value in result[value, default: 0] += 1 }
    }

    private static func regexMatches(
        _ pattern: String,
        in value: String,
        caseInsensitive: Bool = false
    ) -> [String] {
        let options: NSRegularExpression.Options = caseInsensitive ? [.caseInsensitive] : []
        guard let expression = try? NSRegularExpression(pattern: pattern, options: options) else { return [] }
        let range = NSRange(value.startIndex..<value.endIndex, in: value)
        return expression.matches(in: value, range: range).compactMap { match in
            Range(match.range, in: value).map { String(value[$0]) }
        }
    }

    private static func regexCaptureMatches(_ pattern: String, in value: String) -> [String] {
        guard let expression = try? NSRegularExpression(pattern: pattern) else { return [] }
        let range = NSRange(value.startIndex..<value.endIndex, in: value)
        return expression.matches(in: value, range: range).compactMap { match in
            Range(match.range(at: 1), in: value).map { String(value[$0]) }
        }
    }
}
