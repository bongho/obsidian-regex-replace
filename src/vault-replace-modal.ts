import { App, Modal, Notice, TFile } from 'obsidian';
import { collectFiles, frontmatterOffset, parseExcludeGlobs } from './vault-scan';
import { FileMatches, MatchPayload, runVaultMatch } from './vault-match';
import type RegexReplacePlugin from '../main';

// Measurement prototype for vault-wide replace. It scans and reports; it does
// not write. The numbers it prints are the input to the v1 design decision on
// how much of the match list can be rendered at once.
export class VaultReplaceModal extends Modal {
	private plugin: RegexReplacePlugin;
	private patternInput: HTMLInputElement;
	private folderInput: HTMLInputElement;
	private frontmatterCheckbox: HTMLInputElement;
	private statusEl: HTMLElement;
	private metricsEl: HTMLElement;
	private resultsEl: HTMLElement;
	private expandMeasured = false;

	constructor(app: App, plugin: RegexReplacePlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('regex-replace-modal');
		contentEl.createEl('h2', { text: 'Replace in vault (scan only)' });
		contentEl.createEl('p', {
			cls: 'regex-replace-vault-note',
			text: 'This prototype reports what would match. It does not change any file.'
		});

		this.patternInput = this.createTextField(contentEl, 'Search pattern', '\\[\\[([^\\]]+)\\]\\]');
		this.folderInput = this.createTextField(contentEl, 'Folder (blank = whole vault)', '');
		this.frontmatterCheckbox = this.createCheckbox(contentEl, 'Skip frontmatter');

		const buttons = contentEl.createDiv({ cls: 'regex-replace-buttons' });
		const scan = buttons.createEl('button', { text: 'Scan vault', cls: 'mod-cta' });
		scan.addEventListener('click', () => { void this.scan(); });
		const cancel = buttons.createEl('button', { text: 'Close' });
		cancel.addEventListener('click', () => this.close());

		this.statusEl = contentEl.createDiv({ cls: 'regex-replace-match-count' });
		this.metricsEl = contentEl.createDiv({ cls: 'regex-replace-vault-metrics' });
		this.resultsEl = contentEl.createDiv({ cls: 'regex-replace-vault-results' });
	}

	private createTextField(container: HTMLElement, label: string, placeholder: string): HTMLInputElement {
		const field = container.createDiv({ cls: 'regex-replace-field' });
		field.createEl('label', { text: label });
		return field.createEl('input', {
			type: 'text',
			cls: 'regex-replace-input',
			attr: { placeholder }
		});
	}

	private createCheckbox(container: HTMLElement, text: string): HTMLInputElement {
		const field = container.createDiv({ cls: 'regex-replace-field' });
		const label = field.createEl('label', { cls: 'regex-replace-flag-label' });
		const checkbox = label.createEl('input', { type: 'checkbox' });
		label.appendText(` ${text}`);
		return checkbox;
	}

	private async scan(): Promise<void> {
		const pattern = this.patternInput.value;
		if (!pattern) {
			new Notice('Enter a search pattern');
			return;
		}

		this.expandMeasured = false;
		this.resultsEl.empty();
		this.metricsEl.empty();
		this.statusEl.setText('Collecting files…');

		const excludes = parseExcludeGlobs(this.plugin.settings.vaultExcludeGlobs);
		const enumStart = performance.now();
		const files = collectFiles(this.app, this.folderInput.value, excludes);
		const enumerateMs = performance.now() - enumStart;

		const { payloads, readMs, chars } = await this.readAll(files);

		try {
			const run = await runVaultMatch(
				payloads,
				pattern,
				this.plugin.settings.defaultFlags,
				this.plugin.settings.vaultMatchTimeoutMs,
				(done, total) => this.statusEl.setText(`Matching ${done} / ${total}…`)
			);
			const renderStart = performance.now();
			this.renderResults(run.results);
			const renderMs = performance.now() - renderStart;
			this.reportMetrics({
				files: files.length,
				chars,
				enumerateMs,
				readMs,
				matchMs: run.matchMs,
				renderMs,
				results: run.results
			});
		} catch (e) {
			this.statusEl.setText('');
			this.metricsEl.setText(String(e instanceof Error ? e.message : e));
			this.metricsEl.addClass('regex-replace-error');
		}
	}

	private async readAll(files: TFile[]): Promise<{ payloads: MatchPayload[]; readMs: number; chars: number }> {
		const skipFrontmatter = this.frontmatterCheckbox.checked;
		const payloads: MatchPayload[] = [];
		let chars = 0;
		const start = performance.now();
		for (const file of files) {
			const text = await this.app.vault.cachedRead(file);
			const offset = frontmatterOffset(this.app, file, skipFrontmatter);
			chars += text.length;
			payloads.push({ path: file.path, text: offset ? text.slice(offset) : text, offset });
		}
		return { payloads, readMs: performance.now() - start, chars };
	}

	// Every file starts collapsed and renders its matches on first expand. The
	// whole point of the measurement is the gap between these two numbers.
	private renderResults(results: FileMatches[]): void {
		this.resultsEl.empty();
		for (const file of results) {
			const row = this.resultsEl.createDiv({ cls: 'regex-replace-vault-file' });
			const header = row.createDiv({ cls: 'regex-replace-vault-file-header' });
			header.createEl('input', { type: 'checkbox' });
			header.createSpan({ text: ` ${file.path} — ${file.matches.length} match(es)` });
			const body = row.createDiv({ cls: 'regex-replace-vault-file-body' });
			let rendered = false;
			header.addEventListener('click', (e) => {
				if ((e.target as HTMLElement).tagName === 'INPUT') return;
				row.toggleClass('is-expanded', !row.hasClass('is-expanded'));
				if (!rendered) {
					rendered = true;
					this.renderMatches(body, file);
				}
			});
		}
	}

	private renderMatches(body: HTMLElement, file: FileMatches): void {
		const start = performance.now();
		const list = body.createEl('ol', { cls: 'regex-replace-match-list' });
		for (const match of file.matches) {
			list.createEl('li', { cls: 'regex-replace-match-text', text: match.text });
		}
		if (!this.expandMeasured) {
			this.expandMeasured = true;
			const ms = performance.now() - start;
			this.metricsEl.createDiv({
				text: `first expand (${file.matches.length} matches): ${ms.toFixed(1)} ms`
			});
		}
	}

	private reportMetrics(m: {
		files: number;
		chars: number;
		enumerateMs: number;
		readMs: number;
		matchMs: number;
		renderMs: number;
		results: FileMatches[];
	}): void {
		const matches = m.results.reduce((sum, file) => sum + file.matches.length, 0);
		this.statusEl.setText(`${matches} match(es) in ${m.results.length} file(s)`);
		const lines = [
			`files scanned: ${m.files} (${m.chars.toLocaleString()} chars)`,
			`enumerate: ${m.enumerateMs.toFixed(1)} ms`,
			`cachedRead: ${m.readMs.toFixed(1)} ms`,
			`worker match: ${m.matchMs.toFixed(1)} ms`,
			`collapsed render (${m.results.length} rows): ${m.renderMs.toFixed(1)} ms`
		];
		for (const line of lines) {
			this.metricsEl.createDiv({ text: line });
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
