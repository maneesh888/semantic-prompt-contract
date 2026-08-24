import Foundation

public enum SemanticPlainTextValidationError: Error, Equatable, Sendable {
    case unsupportedOperation(String)
    case invalidEncoding
    case empty
    case unchanged
    case commentary
    case rawError
    case markdownFence
    case lineBreaks
    case truncated
    case unsafeExpansion
    case sourceFragment
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
        guard let policy = rendering.plainTextValidationPolicy else {
            throw SemanticPlainTextValidationError.unsupportedOperation(operationID)
        }
        guard !response.unicodeScalars.contains(where: { $0.value == 0 || $0.value == 0xFFFD }) else {
            throw SemanticPlainTextValidationError.invalidEncoding
        }

        let sourceParts = boundaryParts(source)
        let responseParts = boundaryParts(response)
        let sourceCore = sourceParts.core
        let responseCore = responseParts.core
        guard !responseCore.isEmpty else { throw SemanticPlainTextValidationError.empty }
        guard !policy.rejectUnchanged || responseCore != sourceCore else {
            throw SemanticPlainTextValidationError.unchanged
        }

        let commentaryPrefixes = [
            "here is the rewrite:", "here is the rewritten text:", "here is the improved text:",
            "rewritten text:", "improved text:", "rewrite:", "sure,", "certainly,", "of course,",
            "i rewrote ", "i have rewritten ", "i improved ", "i have improved ",
        ]
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

        if policy.rejectNewMarkdownFences {
            let introducedOpeningFence = responseCore.hasPrefix("```") && !sourceCore.hasPrefix("```")
            let introducedClosingFence = responseCore.hasSuffix("```") && !sourceCore.hasSuffix("```")
            guard !introducedOpeningFence, !introducedClosingFence else {
                throw SemanticPlainTextValidationError.markdownFence
            }
        }

        if policy.preserveLineBreaks,
           multiset(regexMatches(#"\r\n|\r|\n"#, in: sourceCore))
            != multiset(regexMatches(#"\r\n|\r|\n"#, in: responseCore)) {
            throw SemanticPlainTextValidationError.lineBreaks
        }

        let sourceLength = sourceCore.unicodeScalars.count
        let responseLength = responseCore.unicodeScalars.count
        if sourceLength >= 20,
           Double(responseLength) < ceil(Double(sourceLength) * policy.minimumLengthRatio) {
            throw SemanticPlainTextValidationError.truncated
        }
        if sourceLength >= 20,
           Double(responseLength) > floor(Double(sourceLength) * policy.maximumLengthRatio) {
            throw SemanticPlainTextValidationError.unsafeExpansion
        }
        if responseLength - sourceLength > policy.maximumAddedCharacters {
            throw SemanticPlainTextValidationError.unsafeExpansion
        }
        if policy.rejectSourceFragment,
           responseCore != sourceCore,
           responseCore.count < sourceCore.count,
           sourceCore.hasPrefix(responseCore) || sourceCore.hasSuffix(responseCore) {
            throw SemanticPlainTextValidationError.sourceFragment
        }

        for type in policy.protectedTokenTypes {
            guard multiset(protectedTokens(in: sourceCore, type: type))
                    == multiset(protectedTokens(in: responseCore, type: type)) else {
                throw SemanticPlainTextValidationError.protectedToken(type)
            }
        }
        guard wordOverlapRatio(sourceCore, responseCore) >= policy.minimumWordOverlapRatio else {
            throw SemanticPlainTextValidationError.meaningOverlap
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
