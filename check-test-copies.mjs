/**
 * Guards the one structural weakness in this repo's test suite: `test.ts`
 * copies the functions it tests out of `src/` instead of importing them (it has
 * no imports at all, which is what lets ts-node run it under "module": "ESNext"
 * without a loader). A green `npm test` therefore proves the copy correct, not
 * the shipped code, and until now nothing noticed when the two drifted apart.
 *
 * This compares every copy against its original by function *body*, parsed with
 * the TypeScript AST rather than matched by hand, and fails the run when they
 * differ. Signatures are deliberately out of scope: `test.ts` cannot name the
 * types it would need to import, so several copies carry structurally
 * equivalent inline parameter types. A renamed or reordered parameter that is
 * never read in the body slips through; anything the body does is caught.
 *
 * Copies are discovered, not listed: any top-level function or class method in
 * `test.ts` whose name also exists in `src/` or `main.ts` is treated as a copy.
 * Adding one needs no change here.
 */
import ts from 'typescript';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SOURCES = [
	...readdirSync('src')
		.filter(f => f.endsWith('.ts'))
		.map(f => join('src', f)),
	'main.ts',
];

function parse(path) {
	return ts.createSourceFile(
		path,
		readFileSync(path, 'utf8'),
		ts.ScriptTarget.Latest,
		true
	);
}

/** name -> { body, path }, where name is `fn` or `Class.method`. */
function collect(file) {
	const out = new Map();
	const add = (name, node) => {
		if (node.body) out.set(name, { body: node.body.getText(file), path: file.fileName });
	};
	for (const stmt of file.statements) {
		if (ts.isFunctionDeclaration(stmt) && stmt.name) {
			add(stmt.name.text, stmt);
		} else if (ts.isClassDeclaration(stmt) && stmt.name) {
			for (const member of stmt.members) {
				if (ts.isMethodDeclaration(member) && member.name) {
					add(`${stmt.name.text}.${member.name.getText(file)}`, member);
				}
			}
		}
	}
	return out;
}

const normalize = body => body.replace(/\s+/g, ' ').trim();

const originals = new Map();
for (const path of SOURCES) {
	for (const [name, entry] of collect(parse(path))) {
		if (!originals.has(name)) originals.set(name, entry);
	}
}

const copies = collect(parse('test.ts'));
const drifted = [];
let checked = 0;

for (const [name, copy] of copies) {
	const original = originals.get(name);
	if (!original) continue; // harness-local helper, not a copy
	checked++;
	if (normalize(copy.body) !== normalize(original.body)) {
		drifted.push({ name, original });
	}
}

if (drifted.length === 0) {
	console.log(`check-test-copies: ${checked} copies match their originals`);
	process.exit(0);
}

console.error(
	`check-test-copies: ${drifted.length} of ${checked} copies no longer match ` +
		`their originals in src/.\n` +
		`A passing test suite says nothing about the shipped code until these agree.\n`
);
for (const { name, original } of drifted) {
	console.error(`  ${name} — copy in test.ts differs from ${original.path}`);
}
console.error(`\nUpdate the copy in test.ts to match, then run this again.`);
process.exit(1);
