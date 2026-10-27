import { MatchInfo, ReplaceResult, PipelineRule, PipelineStep } from './types';

// Default flags applied to an imported regex-pipeline rule when it specifies
// none. regex-pipeline appends `gm` by default, so imports stay faithful.
const PIPELINE_DEFAULT_FLAGS = 'gm';

// Number of characters rendered before the first match so it is not flush
// against the top edge of the preview window.
const CONTEXT_BEFORE = 200;

// Computes the slice of text to render in the preview so the first match is
// visible even when it occurs far past the start of a large document.
// Returns positions in the coordinate space of the text it is given (input
// space for "Before", output space for "After").
export function computePreviewWindow(
	textLength: number,
	firstMatchIndex: number,
	maxLen: number,
	contextBefore: number
): { start: number; end: number } {
	if (textLength <= maxLen) {
		return { start: 0, end: textLength };
	}
	let start = Math.max(0, firstMatchIndex - contextBefore);
	let end = start + maxLen;
	if (end > textLength) {
		end = textLength;
		start = Math.max(0, end - maxLen);
	}
	return { start, end };
}

// The character budget the preview windows render within, and the head-room
// before the first match. Exported so UI code shares one definition.
export const PREVIEW_CONTEXT_BEFORE = CONTEXT_BEFORE;

// How a case operator in a replacement template recases what follows.
type CaseMode = 'none' | 'upper' | 'lower';

export class RegexEngine {
	static compile(pattern: string, flags: string): RegExp | null {
		try {
			return new RegExp(pattern, flags);
		} catch {
			return null;
		}
	}

	// Case operators in the replacement, following the sed / vim / VS Code
	// convention: \U and \L recase everything that follows until \E, while
	// \u and \l affect only the next character.
	private static readonly SPAN_OPS: Record<string, CaseMode> = {
		U: 'upper',
		L: 'lower',
		E: 'none'
	};

	// Expands a replacement template against one match: the `$` group
	// references, the \n / \t / \r escapes, and the case operators above.
	// Done by hand rather than through String.replace's own `$` expansion
	// because a case operator has to see where each group's text begins and
	// ends, which the native expansion never exposes.
	private static expandReplacement(
		template: string,
		m: readonly (string | undefined)[],
		groups: Record<string, string> | undefined,
		offset: number,
		source: string
	): string {
		const matched = m[0] ?? '';
		let out = '';
		let span: CaseMode = 'none';
		let pending: CaseMode = 'none';

		const recase = (part: string): string =>
			span === 'upper' ? part.toUpperCase() : span === 'lower' ? part.toLowerCase() : part;

		// \u / \l bind to the next character that is actually emitted, so an
		// empty group in between passes the pending operator along.
		const emit = (part: string): void => {
			if (!part) return;
			if (pending !== 'none') {
				const head = pending === 'upper' ? part[0].toUpperCase() : part[0].toLowerCase();
				pending = 'none';
				out += head + recase(part.slice(1));
				return;
			}
			out += recase(part);
		};

		let i = 0;
		while (i < template.length) {
			const ch = template[i];

			if (ch === '\\' && i + 1 < template.length) {
				const next = template[i + 1];
				if (next === 'U' || next === 'L' || next === 'E') {
					span = this.SPAN_OPS[next];
					pending = 'none';
					i += 2;
					continue;
				}
				if (next === 'u' || next === 'l') {
					pending = next === 'u' ? 'upper' : 'lower';
					i += 2;
					continue;
				}
				if (next === 'n' || next === 't' || next === 'r') {
					emit(next === 'n' ? '\n' : next === 't' ? '\t' : '\r');
					i += 2;
					continue;
				}
				// Any other escape is left exactly as written, which is what the
				// earlier string-level processing did.
				emit('\\');
				i += 1;
				continue;
			}

			if (ch === '$' && i + 1 < template.length) {
				const next = template[i + 1];
				if (next === '$') { emit('$'); i += 2; continue; }
				if (next === '&') { emit(matched); i += 2; continue; }
				if (next === '`') { emit(source.slice(0, offset)); i += 2; continue; }
				if (next === "'") { emit(source.slice(offset + matched.length)); i += 2; continue; }
				if (next === '<') {
					const end = template.indexOf('>', i + 2);
					if (end !== -1) {
						emit(groups?.[template.slice(i + 2, end)] ?? '');
						i = end + 1;
						continue;
					}
				}
				const digits = /^\d{1,2}/.exec(template.slice(i + 1));
				if (digits) {
					// Two digits win only when that group exists, which is how
					// String.replace itself reads `$12` in a one-group pattern.
					let ref = digits[0];
					if (ref.length === 2 && parseInt(ref, 10) >= m.length) {
						ref = ref[0];
					}
					emit(m[parseInt(ref, 10)] ?? '');
					i += 1 + ref.length;
					continue;
				}
			}

			// Plain run up to the next operator, emitted in one piece so a
			// pending \u applies to its first character and not to each one.
			let j = i;
			while (j < template.length && template[j] !== '\\' && template[j] !== '$') j++;
			if (j === i) j = i + 1;
			emit(template.slice(i, j));
			i = j;
		}

		return out;
	}

	// Adapts String.replace's positional callback arguments to the shape
	// expandReplacement wants. The named-groups object, when the pattern has
	// one, always arrives last.
	private static replacer(template: string): (substring: string, ...rest: unknown[]) => string {
		return (substring: string, ...rest: unknown[]): string => {
			const tail = [...rest];
			const last = tail[tail.length - 1];
			const groups =
				last !== null && typeof last === 'object'
					? (tail.pop() as Record<string, string>)
					: undefined;
			const source = tail.pop() as string;
			const offset = tail.pop() as number;
			return this.expandReplacement(
				template,
				[substring, ...(tail as (string | undefined)[])],
				groups,
				offset,
				source
			);
		};
	}

	static preview(
		text: string,
		pattern: string,
		replacement: string,
		flags: string
	): ReplaceResult | { error: string } {
		const regex = this.compile(pattern, flags);
		if (!regex) {
			return { error: 'Invalid regular expression' };
		}

		try {
			const replaced = text.replace(regex, this.replacer(replacement));
			const matchInfos = this.collectMatches(text, pattern, replacement, flags);

			return {
				original: text,
				replaced,
				matchCount: matchInfos.length,
				matches: matchInfos
			};
		} catch (e) {
			return { error: String(e) };
		}
	}

	private static collectMatches(
		text: string,
		pattern: string,
		replacement: string,
		flags: string
	): MatchInfo[] {
		const matchInfos: MatchInfo[] = [];
		const globalFlags = flags.includes('g') ? flags : flags + 'g';
		const globalRegex = new RegExp(pattern, globalFlags);
		let match;

		while ((match = globalRegex.exec(text)) !== null) {
			const matchedText = match[0];
			// Compute replacement by substituting group references directly from
			// the exec result, rather than re-running the regex on the matched
			// substring. Re-running loses surrounding context, so lookbehind /
			// lookahead assertions match at wrong positions and produce a
			// misleading preview (the actual replacement via text.replace() is
			// unaffected and always correct).
			const replacementText = this.expandReplacement(
				replacement,
				match,
				match.groups,
				match.index,
				text
			);

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

		return matchInfos;
	}


	static execute(
		text: string,
		pattern: string,
		replacement: string,
		flags: string
	): string | { error: string } {
		const regex = this.compile(pattern, flags);
		if (!regex) {
			return { error: 'Invalid regular expression' };
		}

		try {
			return text.replace(regex, this.replacer(replacement));
		} catch (e) {
			return { error: String(e) };
		}
	}

	// Applies rules in sequence, each operating on the previous rule's output.
	// A rule whose regex fails to compile/run is skipped and reported, so one
	// bad rule never aborts the whole pipeline.
	static executePipeline(
		text: string,
		rules: PipelineRule[]
	): { result: string; warnings: string[] } {
		let current = text;
		const warnings: string[] = [];

		rules.forEach((rule, i) => {
			const out = this.execute(current, rule.search, rule.replace, rule.flags || 'g');
			if (typeof out === 'object' && 'error' in out) {
				warnings.push(`Rule ${i + 1} ("${rule.search}"): ${out.error}`);
				return;
			}
			current = out;
		});

		return { result: current, warnings };
	}

	// Builds a step-by-step preview of the pipeline so each rule's cumulative
	// effect (and match count) is visible before applying.
	static previewPipeline(text: string, rules: PipelineRule[]): PipelineStep[] {
		const steps: PipelineStep[] = [];
		let current = text;

		rules.forEach((rule, i) => {
			const pv = this.preview(current, rule.search, rule.replace, rule.flags || 'g');
			if ('error' in pv) {
				steps.push({
					stepIndex: i,
					search: rule.search,
					matchCount: 0,
					before: current,
					after: current,
					error: pv.error
				});
				return;
			}
			steps.push({
				stepIndex: i,
				search: rule.search,
				matchCount: pv.matchCount,
				before: current,
				after: pv.replaced
			});
			current = pv.replaced;
		});

		return steps;
	}
}

// Parses regex-pipeline ruleset syntax (`"SEARCH"flags->"REPLACE"`, one or more
// rules, newlines allowed around the arrow) into PipelineRule[]. Quotes inside
// a pattern are not supported (matching regex-pipeline's own limitation), and
// malformed fragments are simply skipped by the matcher.
export function parsePipelineRuleset(content: string): PipelineRule[] {
	const rules: PipelineRule[] = [];
	const ruleRe = /"([^"]*?)"([a-zA-Z]*)\s*->\s*"([^"]*?)"/gs;
	let m: RegExpExecArray | null;
	while ((m = ruleRe.exec(content)) !== null) {
		rules.push({
			search: m[1],
			replace: m[3],
			flags: m[2] || PIPELINE_DEFAULT_FLAGS
		});
	}
	return rules;
}
