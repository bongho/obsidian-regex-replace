/**
 * Regex Replace Plugin - Unit Tests
 * Run with: node test.js
 */

// ============================================================================
// RegexEngine (copied for testing)
// ============================================================================

class RegexEngine {
	static compile(pattern, flags) {
		try {
			return new RegExp(pattern, flags);
		} catch (e) {
			return null;
		}
	}

	static preview(text, pattern, replacement, flags) {
		const regex = this.compile(pattern, flags);
		if (!regex) {
			return { error: 'Invalid regular expression' };
		}

		try {
			const replaced = text.replace(regex, replacement);
			const matchInfos = [];
			const globalRegex = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
			let match;

			while ((match = globalRegex.exec(text)) !== null) {
				const matchedText = match[0];
				const replacementText = matchedText.replace(new RegExp(pattern, flags.replace('g', '')), replacement);

				matchInfos.push({
					index: match.index,
					length: matchedText.length,
					match: matchedText,
					replacement: replacementText
				});

				if (match.index === globalRegex.lastIndex) {
					globalRegex.lastIndex++;
				}
			}

			return {
				original: text,
				replaced: replaced,
				matchCount: matchInfos.length,
				matches: matchInfos
			};
		} catch (e) {
			return { error: String(e) };
		}
	}

	static execute(text, pattern, replacement, flags) {
		const regex = this.compile(pattern, flags);
		if (!regex) {
			return { error: 'Invalid regular expression' };
		}

		try {
			return text.replace(regex, replacement);
		} catch (e) {
			return { error: String(e) };
		}
	}
}

// ============================================================================
// Test Framework
// ============================================================================

let passed = 0;
let failed = 0;

function test(name, fn) {
	try {
		fn();
		console.log(`✅ ${name}`);
		passed++;
	} catch (e) {
		console.log(`❌ ${name}`);
		console.log(`   Error: ${e.message}`);
		failed++;
	}
}

function assertEqual(actual, expected, message) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${message || 'Assertion failed'}\n   Expected: ${JSON.stringify(expected)}\n   Actual: ${JSON.stringify(actual)}`);
	}
}

function assertTrue(condition, message) {
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
	const result = RegexEngine.execute('- item1\n- item2\n- item3', '^- ', '1. ', 'gm');
	assertEqual(result, '1. item1\n1. item2\n1. item3');
});

// --- Additional Edge Cases ---
console.log('\n--- Additional Edge Cases ---');

test('Lookahead pattern', () => {
	const result = RegexEngine.execute('test123test456', 'test(?=\\d)', 'MATCH', 'g');
	assertEqual(result, 'MATCH123MATCH456');
});

test('Lookbehind pattern', () => {
	const result = RegexEngine.execute('$100 and $200', '(?<=\\$)\\d+', 'XXX', 'g');
	assertEqual(result, '$XXX and $XXX');
});

test('Escaped special characters', () => {
	const result = RegexEngine.execute('Price: $10.00', '\\$\\d+\\.\\d+', '[PRICE]', 'g');
	assertEqual(result, 'Price: [PRICE]');
});

test('Zero-length match handling', () => {
	const result = RegexEngine.preview('abc', '', 'X', 'g');
	assertTrue(!('error' in result));
	if (!('error' in result)) {
		assertEqual(result.matchCount, 4); // Before each char + end
	}
});

test('Very many matches', () => {
	const text = 'a '.repeat(1000);
	const result = RegexEngine.preview(text, 'a', 'b', 'g');
	assertTrue(!('error' in result));
	if (!('error' in result)) {
		assertEqual(result.matchCount, 1000);
	}
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n========================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('========================================\n');

if (failed > 0) {
	process.exit(1);
} else {
	console.log('All tests passed! Ready for deployment.\n');
}
