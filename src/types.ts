export interface RegexReplaceSettings {
	defaultFlags: string;
	historyLimit: number;
	showPreview: boolean;
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
export interface RuleSet {
	name: string;
	source: string;
	rules: PipelineRule[];
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
	recentPatterns: [],
	ruleSets: []
};
