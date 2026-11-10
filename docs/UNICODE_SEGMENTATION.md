# Unicode segmentation boundary

Protected emoji are compared as multisets of complete extended grapheme clusters. A cluster is
protected when it contains at least one scalar with the Unicode `Emoji_Presentation` property.

The JavaScript and Kotlin adapters implement the extended-grapheme boundary rules from Unicode
UAX #29 revision 47 in package-owned code. Their Grapheme_Cluster_Break,
Extended_Pictographic, Indic_Conjunct_Break, and Emoji_Presentation tables are generated from the
official Unicode 17 property files; none is maintained by hand. JavaScript, JVM, and macOS tests
run the implementations against every case in the official Unicode 17
`GraphemeBreakTest.txt` corpus.

JavaScript does not use runtime `Intl.Segmenter` or runtime Unicode property escapes for protected
emoji. This keeps protected-emoji segmentation and classification on Unicode 17 even when a
supported Node release embeds older ICU or Unicode data. Swift continues to use native
`String.Character` segmentation. Every native adapter is checked against the complete subset of
the corpus containing an `Emoji_Presentation` scalar, which is the subset this validator can
protect. The shared protected-emoji corpus also covers emoji modifiers on text-presentation bases,
regional-indicator clusters with combining marks, ordinary emoji with combining marks, trailing
ZWJ, and Grapheme_Cluster_Break `Prepend` characters.

## Evidence limits

- JavaScript protected-emoji behavior is independent of the host's embedded Unicode data, but
  other validation still uses runtime Unicode property escapes, case conversion, and normalization.
  Those paths can vary for newly assigned scalars; for example, whether U+11DB0 participates in a
  mention depends on the Node runtime's embedded Unicode data. Supported Node minimums and current
  releases are therefore still tested separately. Swift remains subject to the Unicode behavior of
  the Apple OS and Swift runtime.
- `unicode-segmentation-kotlin` 0.1.1 and 0.2.0 were evaluated and rejected. Neither publishes the
  required macOS x64 artifact, both embed Unicode 16 rather than 17, and both fail Unicode 17
  `GraphemeBreakTest` line 771 by joining two non-`Extended_Pictographic` scissors around ZWJ.
  No dependency or workaround for those defects is retained.
- Platform-native segmentation was also rejected for Kotlin: Foundation composed-character
  sequences split a protected regional-indicator-plus-ZWNJ cluster (corpus line 303), which would
  accept a protected-token mutation that JavaScript and Swift reject.
- JVM and macOS execute the complete shared Kotlin corpus locally. Android and iOS compile the same
  common implementation here, but their runtime tests remain unexecuted until target-specific
  tests run.
- Swift's native `Character` additionally differs from Unicode 17 on eight Indic-conjunct cases
  (corpus lines 785–792). The published cases contain no `Emoji_Presentation` scalar, so they are
  absent from the protected-emoji corpus subset. This difference can still affect validation: if a
  skin-tone modifier is appended to a Khmer conjunct, Swift can protect only its final native
  `Character` while JavaScript and Kotlin protect the complete Unicode 17 grapheme. A mutation to
  the earlier conjunct can therefore be accepted by Swift and rejected by JavaScript/Kotlin. This
  is a known pre-existing limitation; universal protected-emoji parity is not claimed.
- These checks establish the documented Unicode 17 protected-emoji boundary and listed cases.
  They do not justify a broader cross-platform parity claim until independent exact-head review.

The Unicode data files are copied from the Unicode Character Database 17.0.0 and retain their
upstream headers and terms-of-use references.
