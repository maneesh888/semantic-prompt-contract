package com.maneesh.semanticpromptcontract

import platform.Foundation.NSString
import platform.Foundation.precomposedStringWithCompatibilityMapping

@Suppress("CAST_NEVER_SUCCEEDS")
internal actual fun normalizedCompatibility(value: String): String =
    (value as NSString).precomposedStringWithCompatibilityMapping
