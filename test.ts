/**
 * Regex Replace Plugin - Unit Tests
 * Run with: npm test
 * (ts-node --transpile-only against tsconfig.test.json, which compiles to
 *  CommonJS so this file can import src/ directly. The repo's own tsconfig
 *  targets ESNext for the esbuild bundle and would not resolve these imports.)
 */

import { RegexEngine, parsePipelineRuleset, computePreviewWindow } from './src/engine';
import {
	PipelineRule,
	ReceiptEdit,
	hashText,
	isSelectionOnly,
	replayEdits,
	resolveTargetText,
	reverseEdits,
	withGlobalFlag
} from './src/types';
import { isExcluded } from './src/vault-scan';

// ============================================================================
// Test Framework
// ============================================================================

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
	try {
		fn();
		console.log(`✅ ${name}`);
		passed++;
	} catch (e) {
		console.log(`❌ ${name}`);
		console.log(`   Error: ${e}`);
		failed++;
	}
}

function assertEqual(actual: any, expected: any, message?: string) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${message || 'Assertion failed'}\n   Expected: ${JSON.stringify(expected)}\n   Actual: ${JSON.stringify(actual)}`);
	}
}

function assertTrue(condition: boolean, message?: string) {
	if (!condition) {
		throw new Error(message || 'Expected true but got false');
	}
}

// ============================================================================
// Test Cases
// ============================================================================

console.log('\n========================================');
console.log('Regex Replace Plugin - Unit Tests');
console.log('========================================\n');

// --- Basic Replace Tests ---
console.log('--- Basic Replace ---');

test('Simple text replacement', () => {
	const result = RegexEngine.execute('hello world', 'world', 'universe', 'g');
	assertEqual(result, 'hello universe');
});

test('Global replacement (multiple matches)', () => {
	const result = RegexEngine.execute('cat cat cat', 'cat', 'dog', 'g');
	assertEqual(result, 'dog dog dog');
});

test('Non-global replacement (first match only)', () => {
	const result = RegexEngine.execute('cat cat cat', 'cat', 'dog', '');
	assertEqual(result, 'dog cat cat');
});

test('Backslash escapes in the replacement become real characters', () => {
	assertEqual(RegexEngine.execute('a,b', ',', '\\n', 'g'), 'a\nb');
});

test('Case insensitive replacement', () => {
	const result = RegexEngine.execute('Hello HELLO hello', 'hello', 'hi', 'gi');
	assertEqual(result, 'hi hi hi');
});

// --- Regex Pattern Tests ---
console.log('\n--- Regex Patterns ---');

test('Digit pattern \\d+', () => {
	const result = RegexEngine.execute('abc123def456', '\\d+', 'NUM', 'g');
	assertEqual(result, 'abcNUMdefNUM');
});

test('Word boundary \\b', () => {
	const result = RegexEngine.execute('cat catalog cats', '\\bcat\\b', 'dog', 'g');
	assertEqual(result, 'dog catalog cats');
});

test('Multiline ^ anchor', () => {
	const result = RegexEngine.execute('line1\nline2\nline3', '^', '> ', 'gm');
	assertEqual(result, '> line1\n> line2\n> line3');
});

test('Whitespace pattern \\s+', () => {
	const result = RegexEngine.execute('too   many    spaces', '\\s+', ' ', 'g');
	assertEqual(result, 'too many spaces');
});

// --- Capture Group Tests ---
console.log('\n--- Capture Groups ---');

test('Simple capture group $1', () => {
	const result = RegexEngine.execute('hello world', '(\\w+) (\\w+)', '$2 $1', 'g');
	assertEqual(result, 'world hello');
});

test('Date format conversion', () => {
	const result = RegexEngine.execute('2024-12-08', '(\\d{4})-(\\d{2})-(\\d{2})', '$3/$2/$1', 'g');
	assertEqual(result, '08/12/2024');
});

test('Markdown link to plain text', () => {
	const result = RegexEngine.execute('[Click here](https://example.com)', '\\[(.+?)\\]\\((.+?)\\)', '$1: $2', 'g');
	assertEqual(result, 'Click here: https://example.com');
});

test('Multiple capture groups', () => {
	const result = RegexEngine.execute('John Doe, Jane Smith', '(\\w+) (\\w+)', '$2, $1', 'g');
	assertEqual(result, 'Doe, John, Smith, Jane');
});

// --- Preview Function Tests ---
console.log('\n--- Preview Function ---');

test('Preview returns correct match count', () => {
	const result = RegexEngine.preview('cat dog cat bird cat', 'cat', 'kitten', 'g');
	assertTrue(!('error' in result));
	if (!('error' in result)) {
		assertEqual(result.matchCount, 3);
	}
});

test('Preview returns match info with positions', () => {
	const result = RegexEngine.preview('abc123def', '\\d+', 'NUM', 'g');
	assertTrue(!('error' in result));
	if (!('error' in result)) {
		assertEqual(result.matches[0].index, 3);
		assertEqual(result.matches[0].match, '123');
		assertEqual(result.matches[0].replacement, 'NUM');
	}
});

test('Preview shows before/after correctly', () => {
	const result = RegexEngine.preview('hello world', 'world', 'universe', 'g');
	assertTrue(!('error' in result));
	if (!('error' in result)) {
		assertEqual(result.original, 'hello world');
		assertEqual(result.replaced, 'hello universe');
	}
});

// Regression for the reason collectMatches substitutes groups from the exec
// result instead of re-running the regex on the matched substring: the
// substring has no surrounding context, so the assertion fails there and the
// preview shows the match unchanged while the applied replacement differs.
test('Preview replacement survives a lookahead assertion', () => {
	const result = RegexEngine.preview('a1 b2', '\\d(?= b)', 'X', 'g');
	assertTrue(!('error' in result));
	if (!('error' in result)) {
		assertEqual(result.matchCount, 1);
		assertEqual(result.matches[0].replacement, 'X');
		assertEqual(result.replaced, 'aX b2');
	}
});

// --- Edge Cases ---
console.log('\n--- Edge Cases ---');

test('Empty string input', () => {
	const result = RegexEngine.execute('', 'test', 'replace', 'g');
	assertEqual(result, '');
});

test('Empty pattern', () => {
	const result = RegexEngine.execute('hello', '', 'X', 'g');
	assertEqual(result, 'XhXeXlXlXoX');
});

test('No matches found', () => {
	const result = RegexEngine.execute('hello world', 'xyz', 'replace', 'g');
	assertEqual(result, 'hello world');
});

test('Special regex characters in replacement', () => {
	const result = RegexEngine.execute('test', 'test', '$$$', 'g');
	assertEqual(result, '$$');  // $$ becomes single $
});

test('Unicode characters', () => {
	const result = RegexEngine.execute('한글 테스트 한글', '한글', '영어', 'g');
	assertEqual(result, '영어 테스트 영어');
});

test('Very long string (performance)', () => {
	const longString = 'a'.repeat(10000) + 'test' + 'b'.repeat(10000);
	const result = RegexEngine.execute(longString, 'test', 'replaced', 'g');
	assertTrue(typeof result === 'string' && result.includes('replaced'));
});

test('Newlines and special whitespace', () => {
	const result = RegexEngine.execute('line1\n\tline2\r\nline3', '\\s+', ' ', 'g');
	assertEqual(result, 'line1 line2 line3');
});

// --- Error Handling ---
console.log('\n--- Error Handling ---');

test('Invalid regex pattern returns error', () => {
	const result = RegexEngine.execute('test', '[invalid', 'replace', 'g');
	assertTrue(typeof result === 'object' && 'error' in result);
});

test('Invalid regex in preview returns error', () => {
	const result = RegexEngine.preview('test', '(unclosed', 'replace', 'g');
	assertTrue('error' in result);
});

test('Compile returns null for invalid pattern', () => {
	const result = RegexEngine.compile('[invalid', 'g');
	assertEqual(result, null);
});

// --- Obsidian-specific Use Cases ---
console.log('\n--- Obsidian Use Cases ---');

test('Convert wiki links to markdown links', () => {
	const result = RegexEngine.execute('Check [[My Note]] for details', '\\[\\[(.+?)\\]\\]', '[$1]($1.md)', 'g');
	assertEqual(result, 'Check [My Note](My Note.md) for details');
});

test('Remove YAML frontmatter markers', () => {
	const text = '---\ntitle: Test\n---\nContent here';
	const result = RegexEngine.execute(text, '^---\\n[\\s\\S]*?\\n---\\n', '', '');
	assertEqual(result, 'Content here');
});

test('Convert headers H2 to H3', () => {
	const result = RegexEngine.execute('## Header\n## Another', '^## ', '### ', 'gm');
	assertEqual(result, '### Header\n### Another');
});

test('Remove bold markers', () => {
	const result = RegexEngine.execute('This is **bold** text', '\\*\\*(.+?)\\*\\*', '$1', 'g');
	assertEqual(result, 'This is bold text');
});

test('Convert bullet points to numbered list', () => {
	let counter = 0;
	// Note: This tests the basic pattern; actual numbering would need state
	const result = RegexEngine.execute('- item1\n- item2\n- item3', '^- ', '1. ', 'gm');
	assertEqual(result, '1. item1\n1. item2\n1. item3');
});

console.log('\n--- Preview Window ---');

test('Small doc: no windowing', () => {
	assertEqual(computePreviewWindow(500, 10, 1000, 200), { start: 0, end: 500 });
});

test('Match at index 0 in large doc', () => {
	assertEqual(computePreviewWindow(5000, 0, 1000, 200), { start: 0, end: 1000 });
});

test('Far match: window centered before match', () => {
	assertEqual(computePreviewWindow(5000, 3000, 1000, 200), { start: 2800, end: 3800 });
});

test('Match near EOF: tail-clamp and left-shift', () => {
	assertEqual(computePreviewWindow(5000, 4950, 1000, 200), { start: 4000, end: 5000 });
});

test('First match within context: window starts at 0', () => {
	assertEqual(computePreviewWindow(5000, 100, 1000, 200), { start: 0, end: 1000 });
});

test('Boundary: textLength equals maxLen', () => {
	assertEqual(computePreviewWindow(1000, 900, 1000, 200), { start: 0, end: 1000 });
});

// --- Pipeline Execution ---
console.log('\n--- Pipeline Execution ---');

test('Pipeline applies rules in sequence', () => {
	const rules: PipelineRule[] = [
		{ search: 'cat', replace: 'dog', flags: 'g' },
		{ search: 'dog', replace: 'fox', flags: 'g' }
	];
	const { result } = RegexEngine.executePipeline('cat cat', rules);
	assertEqual(result, 'fox fox');  // cat->dog->fox, order matters
});

test('Pipeline cumulative transform', () => {
	const rules: PipelineRule[] = [
		{ search: '##\\s', replace: '### ', flags: 'gm' },
		{ search: '\\s+', replace: ' ', flags: 'g' }
	];
	const { result } = RegexEngine.executePipeline('##  Header', rules);
	assertEqual(result, '### Header');
});

test('Pipeline skips bad rule and reports warning', () => {
	const rules: PipelineRule[] = [
		{ search: '[invalid', replace: 'x', flags: 'g' },
		{ search: 'foo', replace: 'bar', flags: 'g' }
	];
	const { result, warnings } = RegexEngine.executePipeline('foo', rules);
	assertEqual(result, 'bar');
	assertEqual(warnings.length, 1);
});

// --- Pipeline Ruleset Parsing ---
console.log('\n--- Pipeline Ruleset Parsing ---');

test('Parse single rule', () => {
	const rules = parsePipelineRuleset('"foo"->"bar"');
	assertEqual(rules, [{ search: 'foo', replace: 'bar', flags: 'gm' }]);
});

test('Parse multiple rules in one file', () => {
	const rules = parsePipelineRuleset('"foo"->"bar"\n"\\s+"->" "');
	assertEqual(rules.length, 2);
	assertEqual(rules[1], { search: '\\s+', replace: ' ', flags: 'gm' });
});

test('Parse inline flags override default', () => {
	const rules = parsePipelineRuleset('"foo"gi->"bar"');
	assertEqual(rules[0].flags, 'gi');
});

test('Parse newline variations around arrow', () => {
	const rules = parsePipelineRuleset('"foo"\n->\n"bar"');
	assertEqual(rules, [{ search: 'foo', replace: 'bar', flags: 'gm' }]);
});

test('Parse multi-line replacement', () => {
	const rules = parsePipelineRuleset('"foo"->"line1\nline2"');
	assertEqual(rules[0].replace, 'line1\nline2');
});

test('Parse skips blank lines between rules', () => {
	const rules = parsePipelineRuleset('"a"->"b"\n\n\n"c"->"d"');
	assertEqual(rules.length, 2);
});

// --- Selection-only Resolution ---
console.log('\n--- Selection-only Resolution ---');

test('Stored selectionOnly wins over the global default', () => {
	assertEqual(isSelectionOnly({ selectionOnly: true }, { defaultSelectionOnly: false }), true);
	assertEqual(isSelectionOnly({ selectionOnly: false }, { defaultSelectionOnly: true }), false);
});

test('Ruleset without a stored value follows the global default', () => {
	assertEqual(isSelectionOnly({}, { defaultSelectionOnly: true }), true);
	assertEqual(isSelectionOnly({}, { defaultSelectionOnly: false }), false);
});

// --- Selection-only Target Text ---
console.log('\n--- Selection-only Target Text ---');

test('Selection-only with a selection targets the selection', () => {
	assertEqual(resolveTargetText(true, 'picked', 'whole note'), 'picked');
});

test('Selection-only with no selection refuses instead of widening', () => {
	// The bug this guards: an empty selection used to fall back to the whole
	// note, so "replace in selection only" rewrote the entire file.
	assertEqual(resolveTargetText(true, '', 'whole note'), null);
});

test('Whole-note mode ignores the selection', () => {
	assertEqual(resolveTargetText(false, 'picked', 'whole note'), 'whole note');
	assertEqual(resolveTargetText(false, '', 'whole note'), 'whole note');
});

// --- Vault Scan Excludes ---
console.log('\n--- Vault Scan Excludes ---');

test('A bare folder name covers everything beneath it', () => {
	assertEqual(isExcluded('Archive/2020/note.md', ['Archive']), true);
	assertEqual(isExcluded('Archived/note.md', ['Archive']), false);
});

test('Single star stays inside one path segment', () => {
	assertEqual(isExcluded('Templates/daily.md', ['Templates/*']), true);
	assertEqual(isExcluded('Templates/work/daily.md', ['Templates/*']), false);
});

test('Double star crosses segments and allows none', () => {
	assertEqual(isExcluded('Templates/work/daily.md', ['Templates/**']), true);
	assertEqual(isExcluded('a/b/c.md', ['a/**/c.md']), true);
	assertEqual(isExcluded('a/c.md', ['a/**/c.md']), true);
});

test('Extension globs match anywhere the pattern says', () => {
	assertEqual(isExcluded('draw.excalidraw.md', ['*.excalidraw.md']), true);
	assertEqual(isExcluded('sub/draw.excalidraw.md', ['*.excalidraw.md']), false);
	assertEqual(isExcluded('sub/draw.excalidraw.md', ['**/*.excalidraw.md']), true);
});

test('Dots in a pattern are literal, not any-character', () => {
	assertEqual(isExcluded('axmd/note.md', ['a.md']), false);
});

test('Blank lines never exclude anything', () => {
	assertEqual(isExcluded('note.md', ['', '   ']), false);
});

// --- Receipt Fingerprint ---
console.log('\n--- Receipt Fingerprint ---');

test('Same text hashes the same, different text does not', () => {
	assertEqual(hashText('# Heading\n\nbody'), hashText('# Heading\n\nbody'));
	assertTrue(hashText('a') !== hashText('b'));
});

test('A one-character edit changes the hash', () => {
	// This is the whole job: undo must refuse a file that moved since the write.
	assertTrue(hashText('note text') !== hashText('note texts'));
	assertTrue(hashText('note text') !== hashText('note Text'));
});

test('Empty text hashes to the FNV offset basis', () => {
	assertEqual(hashText(''), 0x811c9dc5);
});

test('Hash stays inside unsigned 32-bit range', () => {
	for (const s of ['', 'a', '한글 노트', 'x'.repeat(5000)]) {
		const h = hashText(s);
		assertTrue(h >= 0 && h <= 0xffffffff && Number.isInteger(h));
	}
});

// --- Receipt Edits (round trip) ---
console.log('\n--- Receipt Edits ---');

const roundTrip = (before: string, edits: ReceiptEdit[]) => {
	const after = replayEdits(before, edits);
	return { after, back: reverseEdits(after, edits) };
};

test('Replacement that grows the text reverses exactly', () => {
	const before = 'see [[a]] and [[b]] here';
	const edits = [
		{ index: 4, before: '[[', after: '[[ ' },
		{ index: 14, before: '[[', after: '[[ ' }
	];
	const r = roundTrip(before, edits);
	assertEqual(r.after, 'see [[ a]] and [[ b]] here');
	assertEqual(r.back, before);
});

test('Replacement that shrinks the text reverses exactly', () => {
	const before = 'ALPHA and ALPHA again';
	const edits = [
		{ index: 0, before: 'ALPHA', after: 'X' },
		{ index: 10, before: 'ALPHA', after: 'X' }
	];
	const r = roundTrip(before, edits);
	assertEqual(r.after, 'X and X again');
	assertEqual(r.back, before);
});

test('Deletion reverses exactly', () => {
	const before = 'keep  drop  keep';
	const edits = [{ index: 6, before: 'drop', after: '' }];
	const r = roundTrip(before, edits);
	assertEqual(r.after, 'keep    keep');
	assertEqual(r.back, before);
});

test('An edit at position zero and one at the end both survive', () => {
	const before = 'xmiddlex';
	const edits = [
		{ index: 0, before: 'x', after: 'YY' },
		{ index: 7, before: 'x', after: 'ZZZ' }
	];
	const r = roundTrip(before, edits);
	assertEqual(r.after, 'YYmiddleZZZ');
	assertEqual(r.back, before);
});

test('Korean text round-trips (code units, not bytes)', () => {
	const before = '노트 ALPHA 노트';
	const edits = [{ index: 3, before: 'ALPHA', after: '베타' }];
	const r = roundTrip(before, edits);
	assertEqual(r.after, '노트 베타 노트');
	assertEqual(r.back, before);
});

test('No edits leaves the text alone in both directions', () => {
	const r = roundTrip('unchanged', []);
	assertEqual(r.after, 'unchanged');
	assertEqual(r.back, 'unchanged');
});

// --- Vault Flag Normalisation ---
console.log('\n--- Vault Flag Normalisation ---');

test('Flags without g gain it', () => {
	// The bug this guards: counting forces g, String.replace does not, so an
	// "i"-only run reported every match and changed only the first.
	assertEqual(withGlobalFlag('i'), 'ig');
	assertEqual(withGlobalFlag(''), 'g');
	assertEqual(withGlobalFlag('im'), 'img');
});

test('Flags already carrying g are untouched', () => {
	assertEqual(withGlobalFlag('g'), 'g');
	assertEqual(withGlobalFlag('gm'), 'gm');
	assertEqual(withGlobalFlag('gi'), 'gi');
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n========================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('========================================\n');

if (failed > 0) {
	process.exit(1);
}
