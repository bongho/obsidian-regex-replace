import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting
} from 'obsidian';

interface RegexReplaceSettings {
	defaultFlags: string;
	historyLimit: number;
	showPreview: boolean;
	recentPatterns: PatternHistory[];
}

interface PatternHistory {
	search: string;
	replace: string;
	flags: string;
	timestamp: number;
}

interface ReplaceResult {
	original: string;
	replaced: string;
	matchCount: number;
	matches: MatchInfo[];
}

interface MatchInfo {
	index: number;
	length: number;
	match: string;
	replacement: string;
}

const DEFAULT_SETTINGS: RegexReplaceSettings = {
	defaultFlags: 'g',
	historyLimit: 10,
	showPreview: true,
	recentPatterns: []
};

// Number of characters rendered before the first match so it is not flush
// against the top edge of the preview window.
const CONTEXT_BEFORE = 200;

// Computes the slice of text to render in the preview so the first match is
// visible even when it occurs far past the start of a large document.
// Returns positions in the coordinate space of the text it is given (input
// space for "Before", output space for "After").
function computePreviewWindow(
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

class RegexEngine {
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
		const nonGlobalFlags = flags.replace('g', '');
		let match;

		while ((match = globalRegex.exec(text)) !== null) {
			const matchedText = match[0];
			const replacementText = matchedText.replace(
				new RegExp(pattern, nonGlobalFlags),
				replacement
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
			const processedReplacement = this.processReplacement(replacement);
			return text.replace(regex, processedReplacement);
		} catch (e) {
			return { error: String(e) };
		}
	}
}

class ReplaceModal extends Modal {
	private plugin: RegexReplacePlugin;
	private editor: Editor;
	private searchInput: HTMLInputElement;
	private replaceInput: HTMLInputElement;
	private flagGlobal: HTMLInputElement;
	private flagCase: HTMLInputElement;
	private flagMultiline: HTMLInputElement;
	private previewEl: HTMLElement;
	private matchCountEl: HTMLElement;
	private selectionOnly = false;

	constructor(app: App, plugin: RegexReplacePlugin, editor: Editor) {
		super(app);
		this.plugin = plugin;
		this.editor = editor;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('regex-replace-modal');

		this.createTitle(contentEl);
		this.createSearchField(contentEl);
		this.createReplaceField(contentEl);
		this.createFlagsSection(contentEl);
		this.createSelectionOption(contentEl);
		this.createMatchCount(contentEl);
		this.createPreviewSection(contentEl);
		this.createHistoryDropdown(contentEl);
		this.createButtons(contentEl);
		this.initializeFromSelection();

		this.searchInput.focus();
	}

	private createTitle(container: HTMLElement): void {
		container.createEl('h2', { text: 'Regex replace' });
	}

	private createSearchField(container: HTMLElement): void {
		const searchContainer = container.createDiv({ cls: 'regex-replace-field' });
		searchContainer.createEl('label', { text: 'Search pattern' });
		this.searchInput = searchContainer.createEl('input', {
			type: 'text',
			placeholder: 'Enter regex pattern (e.g., \\d+)',
			cls: 'regex-replace-input'
		});
		this.searchInput.addEventListener('input', () => this.updatePreview());
	}

	private createReplaceField(container: HTMLElement): void {
		const replaceContainer = container.createDiv({ cls: 'regex-replace-field' });
		replaceContainer.createEl('label', { text: 'Replace with' });
		this.replaceInput = replaceContainer.createEl('input', {
			type: 'text',
			placeholder: 'Replacement text ($1, $2 for groups)',
			cls: 'regex-replace-input'
		});
		this.replaceInput.addEventListener('input', () => this.updatePreview());
	}

	private createFlagsSection(container: HTMLElement): void {
		const flagsContainer = container.createDiv({ cls: 'regex-replace-flags' });
		flagsContainer.createEl('label', { text: 'Flags' });

		const flagsWrapper = flagsContainer.createDiv({ cls: 'regex-replace-flags-wrapper' });
		const defaultFlags = this.plugin.settings.defaultFlags;

		this.flagGlobal = this.createFlagCheckbox(flagsWrapper, 'g (global)', defaultFlags.includes('g'));
		this.flagCase = this.createFlagCheckbox(flagsWrapper, 'i (ignore case)', defaultFlags.includes('i'));
		this.flagMultiline = this.createFlagCheckbox(flagsWrapper, 'm (multiline)', defaultFlags.includes('m'));
	}

	private createFlagCheckbox(container: HTMLElement, label: string, checked: boolean): HTMLInputElement {
		const labelEl = container.createEl('label', { cls: 'regex-replace-flag-label' });
		const checkbox = labelEl.createEl('input', { type: 'checkbox' });
		checkbox.checked = checked;
		labelEl.appendText(` ${label}`);
		checkbox.addEventListener('change', () => this.updatePreview());
		return checkbox;
	}

	private createSelectionOption(container: HTMLElement): void {
		const selectionContainer = container.createDiv({ cls: 'regex-replace-field' });
		const selectionLabel = selectionContainer.createEl('label', { cls: 'regex-replace-flag-label' });
		const selectionCheckbox = selectionLabel.createEl('input', { type: 'checkbox' });
		selectionLabel.appendText(' Replace in selection only');
		selectionCheckbox.addEventListener('change', (e) => {
			this.selectionOnly = (e.target as HTMLInputElement).checked;
			this.updatePreview();
		});
	}

	private createMatchCount(container: HTMLElement): void {
		this.matchCountEl = container.createDiv({ cls: 'regex-replace-match-count' });
	}

	private createPreviewSection(container: HTMLElement): void {
		if (!this.plugin.settings.showPreview) return;

		const previewContainer = container.createDiv({ cls: 'regex-replace-preview-container' });
		previewContainer.createEl('label', { text: 'Preview' });
		this.previewEl = previewContainer.createDiv({ cls: 'regex-replace-preview' });
	}

	private createHistoryDropdown(container: HTMLElement): void {
		const patterns = this.plugin.settings.recentPatterns;
		if (patterns.length === 0) return;

		const historyContainer = container.createDiv({ cls: 'regex-replace-history' });
		historyContainer.createEl('label', { text: 'Recent patterns' });
		const historySelect = historyContainer.createEl('select', { cls: 'regex-replace-history-select' });
		historySelect.createEl('option', { text: 'Select a pattern', value: '' });

		patterns.forEach((pattern, index) => {
			historySelect.createEl('option', {
				text: `${pattern.search} → ${pattern.replace}`,
				value: String(index)
			});
		});

		historySelect.addEventListener('change', (e) => {
			const index = parseInt((e.target as HTMLSelectElement).value);
			if (!isNaN(index)) {
				this.loadPattern(patterns[index]);
			}
		});
	}

	private loadPattern(pattern: PatternHistory): void {
		this.searchInput.value = pattern.search;
		this.replaceInput.value = pattern.replace;
		this.flagGlobal.checked = pattern.flags.includes('g');
		this.flagCase.checked = pattern.flags.includes('i');
		this.flagMultiline.checked = pattern.flags.includes('m');
		this.updatePreview();
	}

	private createButtons(container: HTMLElement): void {
		const buttonContainer = container.createDiv({ cls: 'regex-replace-buttons' });

		const replaceButton = buttonContainer.createEl('button', {
			text: 'Replace all',
			cls: 'mod-cta'
		});
		replaceButton.addEventListener('click', () => { void this.performReplace(); });

		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.addEventListener('click', () => this.close());
	}

	private initializeFromSelection(): void {
		const selection = this.editor.getSelection();
		if (selection && selection.length < 100) {
			this.searchInput.value = this.escapeRegex(selection);
			this.updatePreview();
		}
	}

	private escapeRegex(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	private truncate(str: string, maxLen: number): string {
		return str.length <= maxLen ? str : str.substring(0, maxLen) + '...';
	}

	private getFlags(): string {
		let flags = '';
		if (this.flagGlobal.checked) flags += 'g';
		if (this.flagCase.checked) flags += 'i';
		if (this.flagMultiline.checked) flags += 'm';
		return flags;
	}

	private getText(): string {
		if (this.selectionOnly) {
			return this.editor.getSelection() || this.editor.getValue();
		}
		return this.editor.getValue();
	}

	private updatePreview(): void {
		const pattern = this.searchInput.value;
		const replacement = this.replaceInput.value;
		const flags = this.getFlags();

		if (!pattern) {
			this.showEmptyState();
			return;
		}

		const text = this.getText();
		const result = RegexEngine.preview(text, pattern, replacement, flags);

		if ('error' in result) {
			this.showError(result.error);
			return;
		}

		this.showResult(result);
	}

	private showEmptyState(): void {
		this.matchCountEl.setText('');
		if (this.previewEl) {
			this.previewEl.empty();
			this.previewEl.setText('Enter a search pattern to see preview');
		}
	}

	private showError(error: string): void {
		this.matchCountEl.setText(`Error: ${error}`);
		this.matchCountEl.addClass('regex-replace-error');
		if (this.previewEl) {
			this.previewEl.empty();
		}
	}

	private showResult(result: ReplaceResult): void {
		this.matchCountEl.removeClass('regex-replace-error');
		this.matchCountEl.setText(`${result.matchCount} match(es) found`);

		if (!this.previewEl) return;

		this.previewEl.empty();

		if (result.matchCount === 0) {
			this.previewEl.setText('No matches found');
			return;
		}

		this.renderPreview(result);
	}

	private renderPreview(result: ReplaceResult): void {
		const maxLen = 1000;
		const text = result.original;

		const originalDiv = this.previewEl.createDiv({ cls: 'regex-replace-preview-original' });
		originalDiv.createEl('strong', { text: 'Before: ' });
		const originalContent = originalDiv.createEl('div', { cls: 'regex-replace-highlight-content' });
		const firstMatchEl = this.renderHighlightedText(originalContent, text, result.matches, maxLen);

		const replacedDiv = this.previewEl.createDiv({ cls: 'regex-replace-preview-replaced' });
		replacedDiv.createEl('strong', { text: 'After: ' });
		const replacedContent = replacedDiv.createEl('div', { cls: 'regex-replace-highlight-content' });
		this.renderReplacedText(replacedContent, text, result.matches, maxLen);

		this.renderMatchList(result.matches);

		// Scroll the preview to the first match so the change is visible even
		// when it occurs far from the top of a large document (issue #1).
		// 'nearest' only scrolls when the match is off-screen, so it stays calm
		// while typing (the preview re-renders on every keystroke). Deferred a
		// frame so the container has laid out before scrolling.
		if (firstMatchEl) {
			window.requestAnimationFrame(() => firstMatchEl.scrollIntoView({ block: 'nearest' }));
		}
	}

	private renderHighlightedText(
		container: HTMLElement,
		text: string,
		matches: MatchInfo[],
		maxLen: number
	): HTMLElement | null {
		const firstIdx = matches.length ? matches[0].index : 0;
		const { start: winStart, end: winEnd } = computePreviewWindow(
			text.length,
			firstIdx,
			maxLen,
			CONTEXT_BEFORE
		);

		if (winStart > 0) {
			container.createSpan({ text: '...', cls: 'regex-replace-truncated' });
		}

		let firstMatchEl: HTMLElement | null = null;
		let cursor = winStart;

		for (const match of matches) {
			const mStart = match.index;
			const mEnd = match.index + match.length;
			if (mEnd <= winStart) continue;
			if (mStart >= winEnd) break;

			const clipStart = Math.max(mStart, winStart);
			const clipEnd = Math.min(mEnd, winEnd);

			if (clipStart > cursor) {
				container.createSpan({ text: text.substring(cursor, clipStart) });
			}

			const el = container.createSpan({
				text: text.substring(clipStart, clipEnd),
				cls: 'regex-replace-highlight-match'
			});
			if (!firstMatchEl) firstMatchEl = el;

			cursor = clipEnd;
		}

		if (cursor < winEnd) {
			container.createSpan({ text: text.substring(cursor, winEnd) });
		}

		if (winEnd < text.length) {
			container.createSpan({ text: '...', cls: 'regex-replace-truncated' });
		}

		return firstMatchEl;
	}

	private renderReplacedText(
		container: HTMLElement,
		text: string,
		matches: MatchInfo[],
		maxLen: number
	): void {
		const segments = this.buildReplacementSegments(text, matches);

		// Assign each segment an output-space range and find where the first
		// replacement begins, so the window anchors on the actual change.
		let acc = 0;
		let firstReplOutStart = 0;
		let foundFirstRepl = false;
		const ranges = segments.map(segment => {
			const range = { start: acc, end: acc + segment.text.length, segment };
			if (segment.isReplacement && !foundFirstRepl) {
				firstReplOutStart = acc;
				foundFirstRepl = true;
			}
			acc += segment.text.length;
			return range;
		});
		const totalOut = acc;

		const { start: winStart, end: winEnd } = computePreviewWindow(
			totalOut,
			firstReplOutStart,
			maxLen,
			CONTEXT_BEFORE
		);

		if (winStart > 0) {
			container.createSpan({ text: '...', cls: 'regex-replace-truncated' });
		}

		for (const { start: sStart, end: sEnd, segment } of ranges) {
			if (sEnd <= winStart) continue;
			if (sStart >= winEnd) break;

			const clipFrom = Math.max(sStart, winStart) - sStart;
			const clipTo = Math.min(sEnd, winEnd) - sStart;

			container.createSpan({
				text: segment.text.substring(clipFrom, clipTo),
				cls: segment.isReplacement ? 'regex-replace-highlight-replacement' : undefined
			});
		}

		if (winEnd < totalOut) {
			container.createSpan({ text: '...', cls: 'regex-replace-truncated' });
		}
	}

	private buildReplacementSegments(
		text: string,
		matches: MatchInfo[]
	): { text: string; isReplacement: boolean }[] {
		const segments: { text: string; isReplacement: boolean }[] = [];
		let lastIndex = 0;

		for (const match of matches) {
			if (match.index > lastIndex) {
				segments.push({
					text: text.substring(lastIndex, match.index),
					isReplacement: false
				});
			}

			segments.push({
				text: match.replacement,
				isReplacement: true
			});

			lastIndex = match.index + match.length;
		}

		if (lastIndex < text.length) {
			segments.push({
				text: text.substring(lastIndex),
				isReplacement: false
			});
		}

		return segments;
	}

	private renderMatchList(matches: MatchInfo[]): void {
		if (matches.length === 0) return;

		const matchListDiv = this.previewEl.createDiv({ cls: 'regex-replace-match-list' });
		matchListDiv.createEl('strong', { text: `${matches.length} match(es):` });
		const listEl = matchListDiv.createEl('ul');

		const displayMatches = matches.slice(0, 10);
		for (const m of displayMatches) {
			const li = listEl.createEl('li');
			li.createEl('span', {
				text: `"${this.truncate(m.match, 30)}"`,
				cls: 'regex-replace-match-text'
			});
			li.createEl('span', { text: ' → ' });
			li.createEl('span', {
				text: `"${this.truncate(m.replacement, 30)}"`,
				cls: 'regex-replace-replacement-text'
			});
		}

		if (matches.length > 10) {
			listEl.createEl('li', {
				text: `... and ${matches.length - 10} more`,
				cls: 'regex-replace-more'
			});
		}
	}

	private async performReplace(): Promise<void> {
		const pattern = this.searchInput.value;
		const replacement = this.replaceInput.value;
		const flags = this.getFlags();

		if (!pattern) {
			new Notice('Please enter a search pattern');
			return;
		}

		const text = this.getText();
		const result = RegexEngine.execute(text, pattern, replacement, flags);

		if (typeof result === 'object' && 'error' in result) {
			new Notice(`Error: ${result.error}`);
			return;
		}

		this.applyReplacement(result);

		await this.plugin.addToHistory({
			search: pattern,
			replace: replacement,
			flags,
			timestamp: Date.now()
		});

		const previewResult = RegexEngine.preview(text, pattern, replacement, flags);
		const matchCount = 'matchCount' in previewResult ? previewResult.matchCount : 0;

		new Notice(`Replaced ${matchCount} match(es)`);
		this.close();
	}

	private applyReplacement(result: string): void {
		if (this.selectionOnly && this.editor.getSelection()) {
			this.editor.replaceSelection(result);
		} else {
			const cursor = this.editor.getCursor();
			this.editor.setValue(result);
			this.editor.setCursor(cursor);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class RegexReplaceSettingTab extends PluginSettingTab {
	plugin: RegexReplacePlugin;

	constructor(app: App, plugin: RegexReplacePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Default flags')
			.setDesc('Default regex flags (g=global, i=ignore case, m=multiline)')
			.addText(text => text
				.setPlaceholder('Enter flags')
				.setValue(this.plugin.settings.defaultFlags)
				.onChange(async (value) => {
					this.plugin.settings.defaultFlags = value.replace(/[^gim]/g, '');
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Show preview')
			.setDesc('Show before/after preview in the replace dialog')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showPreview)
				.onChange(async (value) => {
					this.plugin.settings.showPreview = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('History limit')
			.setDesc('Maximum number of recent patterns to remember')
			.addSlider(slider => slider
				.setLimits(0, 50, 5)
				.setValue(this.plugin.settings.historyLimit)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.historyLimit = value;
					this.plugin.settings.recentPatterns =
						this.plugin.settings.recentPatterns.slice(0, value);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Clear history')
			.setDesc('Remove all saved patterns from history')
			.addButton(button => button
				.setButtonText('Clear')
				.onClick(() => {
					this.plugin.settings.recentPatterns = [];
					void this.plugin.saveSettings();
					new Notice('History cleared');
				}));
	}
}

export default class RegexReplacePlugin extends Plugin {
	settings: RegexReplaceSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addCommand({
			id: 'open-modal',
			name: 'Open replace modal',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				new ReplaceModal(this.app, this, editor).open();
			}
		});

		this.addCommand({
			id: 'replace-in-selection',
			name: 'Replace in selection',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				new ReplaceModal(this.app, this, editor).open();
			}
		});

		this.addSettingTab(new RegexReplaceSettingTab(this.app, this));
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async addToHistory(pattern: PatternHistory): Promise<void> {
		this.settings.recentPatterns = this.settings.recentPatterns.filter(
			p => p.search !== pattern.search || p.replace !== pattern.replace
		);

		this.settings.recentPatterns.unshift(pattern);
		this.settings.recentPatterns = this.settings.recentPatterns.slice(0, this.settings.historyLimit);

		await this.saveSettings();
	}
}
