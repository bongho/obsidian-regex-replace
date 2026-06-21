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

export class RegexEngine {
	static compile(pattern: string, flags: string): RegExp | null {
		try {
			return new RegExp(pattern, flags);
		} catch {
			return null;
		}
	}

	private static processReplacement(replacement: string): string {
		return replacement
			.replace(/\\n/g, '\n')
			.replace(/\\t/g, '\t')
			.replace(/\\r/g, '\r');
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
			const processedReplacement = this.processReplacement(replacement);
			const replaced = text.replace(regex, processedReplacement);
			const matchInfos = this.collectMatches(text, pattern, processedReplacement, flags);

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
			const replacementText = this.substituteGroups(matchedText, match, replacement);

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

	private static substituteGroups(
		matchedText: string,
		match: RegExpExecArray,
		replacement: string
	): string {
		return replacement
			.replace(/\$\$/g, '\x00')
			.replace(/\$&/g, matchedText)
			.replace(/\$(\d+)/g, (_, n) => match[parseInt(n)] ?? '')
			.replace(/\$<([^>]+)>/g, (_, name) => match.groups?.[name] ?? '')
			.replace(/\x00/g, '$');
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
			const processedReplacement = this.processReplacement(replacement);
			return text.replace(regex, processedReplacement);
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
