export interface RegexReplaceSettings {
	defaultFlags: string;
	historyLimit: number;
	showPreview: boolean;
	defaultSelectionOnly: boolean;
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

// Shown instead of running when a selection-only ruleset is triggered with an
// empty selection. Refusing beats widening to the whole note: the point of the
// flag is that the rest of the note is never touched.
export const NO_SELECTION_NOTICE =
	'This ruleset applies to the selection only — select some text first.';

// Whether a ruleset runs on the selection instead of the whole note. A
// function so the "unset follows the global default" fallback has one home.
export function isSelectionOnly(
	ruleset: Pick<RuleSet, 'selectionOnly'>,
	settings: Pick<RegexReplaceSettings, 'defaultSelectionOnly'>
): boolean {
	return ruleset.selectionOnly ?? settings.defaultSelectionOnly;
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
	recentPatterns: [],
	ruleSets: []
};
