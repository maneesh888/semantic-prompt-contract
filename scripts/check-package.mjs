import { execFileSync } from 'node:child_process';

const output = execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' });
const report = JSON.parse(output)[0];
const required = [
  'contracts/manifest.json',
  'contracts/writing-actions.json',
  'contracts/keyboard-suggestions.json',
  'schemas/contract.schema.json',
  'adapters/swift/Sources/SemanticPromptContract/SemanticPromptContract.generated.swift',
  'adapters/browser/semanticPromptContract.generated.js',
];
const files = new Set(report.files.map((entry) => entry.path));
for (const path of required) {
  if (!files.has(path)) throw new Error(`Packed artifact is missing ${path}`);
}
console.log(`Package artifact contains ${report.files.length} files.`);
