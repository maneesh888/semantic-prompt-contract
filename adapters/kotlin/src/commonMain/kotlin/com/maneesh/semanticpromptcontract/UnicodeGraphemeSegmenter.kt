package com.maneesh.semanticpromptcontract

/** Unicode 17 extended-grapheme segmentation (UAX #29, revision 47). */
internal fun unicode17ExtendedGraphemeClusters(value: String): List<String> {
    val scalars = unicodeScalarSpans(value)
    if (scalars.isEmpty()) return emptyList()
    return buildList {
        var clusterStart = 0
        for (index in 1 until scalars.size) {
            if (isUnicode17GraphemeBoundary(scalars, index)) {
                add(value.substring(scalars[clusterStart].start, scalars[index].start))
                clusterStart = index
            }
        }
        add(value.substring(scalars[clusterStart].start))
    }
}

private data class UnicodeScalarSpan(
    val codePoint: Int,
    val start: Int,
    val end: Int,
    val category: Unicode17GraphemeCategory,
)

private enum class Unicode17GraphemeCategory {
    Any,
    Cr,
    Lf,
    Control,
    Extend,
    RegionalIndicator,
    Prepend,
    SpacingMark,
    L,
    V,
    T,
    Lv,
    LvT,
    Zwj,
}

private fun unicodeScalarSpans(value: String): List<UnicodeScalarSpan> = buildList {
    var index = 0
    while (index < value.length) {
        val start = index
        val first = value[index]
        val codePoint = if (first.isHighSurrogate() && index + 1 < value.length && value[index + 1].isLowSurrogate()) {
            index += 2
            0x10000 + ((first.code - 0xD800) shl 10) + (value[start + 1].code - 0xDC00)
        } else {
            index += 1
            first.code
        }
        add(UnicodeScalarSpan(codePoint, start, index, unicode17GraphemeCategory(codePoint)))
    }
}

private fun unicode17GraphemeCategory(codePoint: Int): Unicode17GraphemeCategory = when {
    codePoint.isInUnicodeRanges(unicode17GraphemeCrRanges) -> Unicode17GraphemeCategory.Cr
    codePoint.isInUnicodeRanges(unicode17GraphemeLfRanges) -> Unicode17GraphemeCategory.Lf
    codePoint.isInUnicodeRanges(unicode17GraphemeControlRanges) -> Unicode17GraphemeCategory.Control
    codePoint.isInUnicodeRanges(unicode17GraphemeExtendRanges) -> Unicode17GraphemeCategory.Extend
    codePoint.isInUnicodeRanges(unicode17GraphemeRegionalIndicatorRanges) ->
        Unicode17GraphemeCategory.RegionalIndicator
    codePoint.isInUnicodeRanges(unicode17GraphemePrependRanges) -> Unicode17GraphemeCategory.Prepend
    codePoint.isInUnicodeRanges(unicode17GraphemeSpacingMarkRanges) -> Unicode17GraphemeCategory.SpacingMark
    codePoint.isInUnicodeRanges(unicode17GraphemeLRanges) -> Unicode17GraphemeCategory.L
    codePoint.isInUnicodeRanges(unicode17GraphemeVRanges) -> Unicode17GraphemeCategory.V
    codePoint.isInUnicodeRanges(unicode17GraphemeTRanges) -> Unicode17GraphemeCategory.T
    codePoint.isInUnicodeRanges(unicode17GraphemeLvRanges) -> Unicode17GraphemeCategory.Lv
    codePoint.isInUnicodeRanges(unicode17GraphemeLvTRanges) -> Unicode17GraphemeCategory.LvT
    codePoint.isInUnicodeRanges(unicode17GraphemeZwjRanges) -> Unicode17GraphemeCategory.Zwj
    else -> Unicode17GraphemeCategory.Any
}

private fun isUnicode17GraphemeBoundary(scalars: List<UnicodeScalarSpan>, index: Int): Boolean {
    val before = scalars[index - 1]
    val after = scalars[index]

    // GB3
    if (before.category == Unicode17GraphemeCategory.Cr && after.category == Unicode17GraphemeCategory.Lf) {
        return false
    }
    // GB4 and GB5
    if (before.category.isControl() || after.category.isControl()) return true
    // GB6
    if (before.category == Unicode17GraphemeCategory.L &&
        (after.category == Unicode17GraphemeCategory.L ||
            after.category == Unicode17GraphemeCategory.V ||
            after.category == Unicode17GraphemeCategory.Lv ||
            after.category == Unicode17GraphemeCategory.LvT)
    ) {
        return false
    }
    // GB7
    if ((before.category == Unicode17GraphemeCategory.Lv || before.category == Unicode17GraphemeCategory.V) &&
        (after.category == Unicode17GraphemeCategory.V || after.category == Unicode17GraphemeCategory.T)
    ) {
        return false
    }
    // GB8
    if ((before.category == Unicode17GraphemeCategory.LvT || before.category == Unicode17GraphemeCategory.T) &&
        after.category == Unicode17GraphemeCategory.T
    ) {
        return false
    }
    // GB9, GB9a, and GB9b
    if (after.category == Unicode17GraphemeCategory.Extend ||
        after.category == Unicode17GraphemeCategory.Zwj ||
        after.category == Unicode17GraphemeCategory.SpacingMark ||
        before.category == Unicode17GraphemeCategory.Prepend
    ) {
        return false
    }
    // GB9c
    if (hasUnicode17InCbConsonantContext(scalars, index)) return false
    // GB11
    if (before.category == Unicode17GraphemeCategory.Zwj &&
        after.codePoint.isInUnicodeRanges(unicode17ExtendedPictographicRanges) &&
        hasUnicode17ExtendedPictographicContext(scalars, index)
    ) {
        return false
    }
    // GB12 and GB13
    if (before.category == Unicode17GraphemeCategory.RegionalIndicator &&
        after.category == Unicode17GraphemeCategory.RegionalIndicator
    ) {
        var regionalIndicatorCount = 0
        var cursor = index - 1
        while (cursor >= 0 && scalars[cursor].category == Unicode17GraphemeCategory.RegionalIndicator) {
            regionalIndicatorCount += 1
            cursor -= 1
        }
        return regionalIndicatorCount % 2 == 0
    }
    // GB999
    return true
}

private fun Unicode17GraphemeCategory.isControl(): Boolean =
    this == Unicode17GraphemeCategory.Control ||
        this == Unicode17GraphemeCategory.Cr ||
        this == Unicode17GraphemeCategory.Lf

private fun hasUnicode17InCbConsonantContext(scalars: List<UnicodeScalarSpan>, index: Int): Boolean {
    if (!scalars[index].codePoint.isInUnicodeRanges(unicode17InCbConsonantRanges)) return false
    var foundLinker = false
    var cursor = index - 1
    while (cursor >= 0) {
        val codePoint = scalars[cursor].codePoint
        when {
            codePoint.isInUnicodeRanges(unicode17InCbLinkerRanges) -> foundLinker = true
            codePoint.isInUnicodeRanges(unicode17InCbExtendRanges) -> Unit
            else -> return foundLinker && codePoint.isInUnicodeRanges(unicode17InCbConsonantRanges)
        }
        cursor -= 1
    }
    return false
}

private fun hasUnicode17ExtendedPictographicContext(scalars: List<UnicodeScalarSpan>, index: Int): Boolean {
    var cursor = index - 2
    while (cursor >= 0 && scalars[cursor].category == Unicode17GraphemeCategory.Extend) cursor -= 1
    return cursor >= 0 && scalars[cursor].codePoint.isInUnicodeRanges(unicode17ExtendedPictographicRanges)
}

private fun Int.isInUnicodeRanges(ranges: IntArray): Boolean {
    var lowerBound = 0
    var upperBound = ranges.size / 2
    while (lowerBound < upperBound) {
        val middle = (lowerBound + upperBound) / 2
        val rangeStart = ranges[middle * 2]
        val rangeEnd = ranges[middle * 2 + 1]
        when {
            this < rangeStart -> upperBound = middle
            this > rangeEnd -> lowerBound = middle + 1
            else -> return true
        }
    }
    return false
}
