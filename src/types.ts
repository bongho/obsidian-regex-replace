export interface RegexReplaceSettings {
	defaultFlags: string;
	historyLimit: number;
	showPreview: boolean;
	defaultSelectionOnly: boolean;
	vaultExcludeGlobs: string;
	vaultMatchTimeoutMs: number;
	vaultApplyWarnFiles: number;
	lastVaultReplace: ApplyReceipt | null;
	recentPatterns: PatternHistory[];
	ruleSets: RuleSet[];
}

export interface PatternHistory {
	search: string;
	replace: string;
	flags: string;
	timestamp: number;
}

// A single find/replace step inside a pipeline ruleset.
export interface PipelineRule {
	search: string;
	replace: string;
	flags: string;
}

// A named, reusable pipeline of rules applied in sequence. `source` is the
// regex-pipeline-syntax text the user edits (SSOT); `rules` is its parsed form.
// `selectionOnly` is absent on rulesets saved before the option existed, so
// those follow the global default — see isSelectionOnly().
export interface RuleSet {
	name: string;
	source: string;
	rules: PipelineRule[];
	selectionOnly?: boolean;
}

// Shown instead of running when a selection-only run is triggered with an empty
// selection. Refusing beats widening to the whole note: the point of the flag is
// that the rest of the note is never touched. Worded without "ruleset" because
// the find/replace dialog shows this too, and it has no ruleset.
export const NO_SELECTION_NOTICE =
	'This runs on the selection only — select some text first.';

// Whether a ruleset runs on the selection instead of the whole note. A
// function so the "unset follows the global default" fallback has one home.
export function isSelectionOnly(
	ruleset: Pick<RuleSet, 'selectionOnly'>,
	settings: Pick<RegexReplaceSettings, 'defaultSelectionOnly'>
): boolean {
	return ruleset.selectionOnly ?? settings.defaultSelectionOnly;
}

// The text a run operates on, or null when the run is selection-only and
// nothing is selected. Both modals route through this, so neither can widen a
// selection-only run to the whole note — the replace modal used to do exactly
// that, because it carried its own copy of this decision.
export function resolveTargetText(
	selectionOnly: boolean,
	selection: string,
	wholeNote: string
): string | null {
	if (!selectionOnly) return wholeNote;
	return selection || null;
}

// One file's scan result. Selection is per file, not per match: rendering all
// 48,020 matches of a wide pattern measured 8.7s, and a checkbox cannot be
// ticked on a row that was never drawn.
export interface VaultHit {
	path: string;
	matchCount: number;
	matches: VaultMatchInfo[];
	selected: boolean;
	// Taken at scan time so apply can tell whether the file moved under us.
	mtime: number;
}

export interface VaultMatchInfo {
	index: number;
	length: number;
	text: string;
}

// The record an undo runs from. `afterHash` fingerprints what the run wrote so
// undo can refuse a file that changed again afterwards.
export interface ApplyReceipt {
	startedAt: number;
	pattern: string;
	flags: string;
	replacement: string;
	files: ReceiptEntry[];
}

// Normally `edits` carries the reversal and scales with match count. `before`
// is the fallback for the rare file whose per-match replacements cannot be
// replayed back into the text the run actually wrote — storing the whole file
// is wasteful but always correct, and a vault-wide run that used it everywhere
// measured 41.8 MB, which is why it is the exception and not the rule.
export interface ReceiptEntry {
	path: string;
	afterHash: number;
	matchCount: number;
	edits?: ReceiptEdit[];
	before?: string;
}

// One replacement, positioned in the pre-run text.
export interface ReceiptEdit {
	index: number;
	before: string;
	after: string;
}

// A vault run counts matches with `g` forced on (both the worker and
// collectMatches do), but String.replace honours the flags as typed — so
// without `g` the scan reports every match while the apply changes only the
// first. Normalising once keeps the two halves talking about the same thing.
export function withGlobalFlag(flags: string): string {
	return flags.includes('g') ? flags : `${flags}g`;
}

// Replays edits forward onto the original text. Used at apply time to prove the
// edit list reproduces what will be written — if it does not, the entry falls
// back to storing the whole file.
export function replayEdits(before: string, edits: ReceiptEdit[]): string {
	let out = '';
	let cursor = 0;
	for (const edit of edits) {
		out += before.slice(cursor, edit.index) + edit.after;
		cursor = edit.index + edit.before.length;
	}
	return out + before.slice(cursor);
}

// Reverses edits against the text the run produced. Walks backwards so each
// splice leaves earlier positions untouched.
export function reverseEdits(after: string, edits: ReceiptEdit[]): string {
	let delta = 0;
	const placed = edits.map(edit => {
		const at = edit.index + delta;
		delta += edit.after.length - edit.before.length;
		return { at, edit };
	});

	let out = after;
	for (let i = placed.length - 1; i >= 0; i--) {
		const { at, edit } = placed[i];
		out = out.slice(0, at) + edit.before + out.slice(at + edit.after.length);
	}
	return out;
}

// FNV-1a. Not cryptographic — it only has to notice that a file changed.
export function hashText(text: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

// One stage of a pipeline preview: the text before/after this rule ran.
export interface PipelineStep {
	stepIndex: number;
	search: string;
	matchCount: number;
	before: string;
	after: string;
	error?: string;
}

export interface MatchInfo {
	index: number;
	length: number;
	match: string;
	replacement: string;
}

export interface ReplaceResult {
	original: string;
	replaced: string;
	matchCount: number;
	matches: MatchInfo[];
}

export const DEFAULT_SETTINGS: RegexReplaceSettings = {
	defaultFlags: 'g',
	historyLimit: 10,
	showPreview: true,
	defaultSelectionOnly: false,
	vaultExcludeGlobs: '',
	vaultMatchTimeoutMs: 2000,
	vaultApplyWarnFiles: 1000,
	lastVaultReplace: null,
	recentPatterns: [],
	ruleSets: []
};
