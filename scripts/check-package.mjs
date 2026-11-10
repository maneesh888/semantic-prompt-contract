import { execFileSync } from 'node:child_process';

const output = execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' });
const report = JSON.parse(output)[0];
const required = [
  'contracts/manifest.json',
  'contracts/writing-actions.json',
  'contracts/keyboard-suggestions.json',
  'schemas/contract.schema.json',
  'schemas/writing-action-response.schema.json',
  'fixtures/plain-text-validation/rewrite-replacements.json',
  'fixtures/plain-text-validation/writing-actions.json',
  'fixtures/unicode/GraphemeBreakTest-17.0.0.txt',
  'fixtures/unicode/GraphemeBreakProperty-17.0.0.txt',
  'fixtures/unicode/IndicConjunctBreak-17.0.0.txt',
  'fixtures/unicode/emoji-data-17.0.0.txt',
  'fixtures/unicode/protected-emoji-cases.json',
  'fixtures/valid-responses/summarize.txt',
  'fixtures/valid-responses/translate.txt',
  'fixtures/valid-responses/continue-writing.txt',
  'fixtures/legacy/writing-action-response.valid.json',
  'fixtures/legacy/writing-action-response.invalid.json',
  'adapters/swift/Sources/SemanticPromptContract/SemanticPromptContract.generated.swift',
  'adapters/swift/Sources/SemanticPromptContract/SemanticPlainTextResponseValidator.swift',
  'adapters/kotlin/src/commonMain/kotlin/com/maneesh/semanticpromptcontract/CanonicalContractData.generated.kt',
  'adapters/kotlin/src/commonMain/kotlin/com/maneesh/semanticpromptcontract/UnicodeData.generated.kt',
  'adapters/kotlin/src/commonMain/kotlin/com/maneesh/semanticpromptcontract/SemanticPromptContract.kt',
  'adapters/kotlin/src/commonMain/kotlin/com/maneesh/semanticpromptcontract/SemanticPlainTextResponseValidator.kt',
  'adapters/kotlin/src/commonMain/kotlin/com/maneesh/semanticpromptcontract/UnicodeGraphemeSegmenter.kt',
  'adapters/kotlin/src/commonTest/kotlin/com/maneesh/semanticpromptcontract/SemanticPromptContractParity.generated.kt',
  'adapters/browser/semanticPromptContract.generated.js',
  'build.gradle.kts',
  'settings.gradle.kts',
  'gradle/wrapper/gradle-wrapper.jar',
  'gradle/wrapper/gradle-wrapper.properties',
  'gradlew',
];
const files = new Set(report.files.map((entry) => entry.path));
for (const path of required) {
  if (!files.has(path)) throw new Error(`Packed artifact is missing ${path}`);
}
console.log(`Package artifact contains ${report.files.length} files.`);
