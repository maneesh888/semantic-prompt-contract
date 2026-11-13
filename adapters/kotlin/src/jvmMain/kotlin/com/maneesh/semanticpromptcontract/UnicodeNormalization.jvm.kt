package com.maneesh.semanticpromptcontract

import java.text.Normalizer

internal actual fun normalizedCompatibility(value: String): String =
    Normalizer.normalize(value, Normalizer.Form.NFKC)
