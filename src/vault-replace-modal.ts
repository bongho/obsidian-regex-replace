import { App, Modal, Notice, TFile } from 'obsidian';
import { collectFiles, frontmatterOffset, parseExcludeGlobs } from './vault-scan';
import { createMatcher, MatchPayload } from './vault-match';
import { applyVaultReplace } from './vault-apply';
import { ApplyReceipt, VaultHit } from './types';
import type RegexReplacePlugin from '../main';

// Files read and matched per round trip. Small enough that progress moves and
// a runaway pattern is blamed on a narrow set of files.
const BATCH_SIZE = 50;

export class VaultReplaceModal extends Modal {
	private plugin: RegexReplacePlugin;
	private patternInput: HTMLInputElement;
	private flagsInput: HTMLInputElement;
	private replacementInput: HTMLInputElement;
	private folderInput: HTMLInputElement;
	private frontmatterCheckbox: HTMLInputElement;
	private statusEl: HTMLElement;
	private metricsEl: HTMLElement;
	private resultsEl: HTMLElement;
	private scanButton: HTMLButtonElement;
	private applyButton: HTMLButtonElement;
	private hits: VaultHit[] = [];
	private running = false;
	private cancelled = false;
	private awaitingConfirm = false;

	constructor(app: App, plugin: RegexReplacePlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('regex-replace-modal');
		contentEl.createEl('h2', { text: 'Replace in vault' });

		this.patternInput = this.textField(contentEl, 'Search pattern', '\\[\\[([^\\]]+)\\]\\]');
		// Flags are a field rather than the global default: a vault pattern is
		// usually line-anchored, and running one without "m" reports zero
		// matches instead of an error.
		this.flagsInput = this.textField(contentEl, 'Flags', 'gm');
		this.flagsInput.value = this.plugin.settings.defaultFlags;
		this.replacementInput = this.textField(contentEl, 'Replace with', '');
		this.folderInput = this.textField(contentEl, 'Folder (blank = whole vault)', '');
		this.frontmatterCheckbox = this.checkbox(contentEl, 'Skip frontmatter');

		const buttons = contentEl.createDiv({ cls: 'regex-replace-buttons' });
		this.scanButton = buttons.createEl('button', { text: 'Scan vault', cls: 'mod-cta' });
		this.scanButton.addEventListener('click', () => { void this.onScanClick(); });
		this.applyButton = buttons.createEl('button', { text: 'Apply' });
		this.applyButton.disabled = true;
		this.applyButton.addEventListener('click', () => { void this.onApplyClick(); });
		const close = buttons.createEl('button', { text: 'Close' });
		close.addEventListener('click', () => this.close());

		this.statusEl = contentEl.createDiv({ cls: 'regex-replace-match-count' });
		this.metricsEl = contentEl.createDiv({ cls: 'regex-replace-vault-metrics' });
		this.resultsEl = contentEl.createDiv({ cls: 'regex-replace-vault-results' });
	}

	private textField(container: HTMLElement, label: string, placeholder: string): HTMLInputElement {
		const field = container.createDiv({ cls: 'regex-replace-field' });
		field.createEl('label', { text: label });
		return field.createEl('input', { type: 'text', cls: 'regex-replace-input', attr: { placeholder } });
	}

	private checkbox(container: HTMLElement, text: string): HTMLInputElement {
		const field = container.createDiv({ cls: 'regex-replace-field' });
		const label = field.createEl('label', { cls: 'regex-replace-flag-label' });
		const input = label.createEl('input', { type: 'checkbox' });
		label.appendText(` ${text}`);
		return input;
	}

	private onScanClick(): Promise<void> {
		if (this.running) {
			this.cancelled = true;
			return Promise.resolve();
		}
		return this.scan();
	}

	private async scan(): Promise<void> {
		const pattern = this.patternInput.value;
		if (!pattern) {
			new Notice('Enter a search pattern');
			return;
		}

		this.running = true;
		this.cancelled = false;
		this.hits = [];
		this.resultsEl.empty();
		this.metricsEl.empty();
		this.metricsEl.removeClass('regex-replace-error');
		this.applyButton.disabled = true;
		this.scanButton.setText('Cancel');

		try {
			await this.streamScan(pattern);
		} catch (e) {
			this.metricsEl.setText(e instanceof Error ? e.message : String(e));
			this.metricsEl.addClass('regex-replace-error');
			this.statusEl.setText('');
		} finally {
			this.running = false;
			this.scanButton.setText('Scan vault');
			this.applyButton.disabled = this.selected().length === 0;
		}
	}

	// Reads and matches one batch at a time so progress reflects real progress,
	// a worker that cannot start shows up on the first batch rather than after
	// the whole vault has been read, and cancelling is possible at all.
	private async streamScan(pattern: string): Promise<void> {
		const excludes = parseExcludeGlobs(this.plugin.settings.vaultExcludeGlobs);
		const enumStart = performance.now();
		const files = collectFiles(this.app, this.folderInput.value, excludes);
		const enumerateMs = performance.now() - enumStart;

		const matcher = await createMatcher(
			pattern, this.flagsInput.value, this.plugin.settings.vaultMatchTimeoutMs
		);
		let readMs = 0;
		let matchMs = 0;
		let renderMs = 0;
		let chars = 0;

		try {
			for (let i = 0; i < files.length; i += BATCH_SIZE) {
				if (this.cancelled) break;
				const batch = files.slice(i, i + BATCH_SIZE);

				const readStart = performance.now();
				const payloads: MatchPayload[] = [];
				for (const file of batch) {
					const text = await this.app.vault.cachedRead(file);
					const offset = frontmatterOffset(this.app, file, this.frontmatterCheckbox.checked);
					chars += text.length;
					payloads.push({ path: file.path, text: offset ? text.slice(offset) : text, offset });
				}
				readMs += performance.now() - readStart;

				const matchStart = performance.now();
				const results = await matcher.run(payloads);
				matchMs += performance.now() - matchStart;

				const renderStart = performance.now();
				this.appendHits(results, batch);
				renderMs += performance.now() - renderStart;

				this.statusEl.setText(`Scanning ${Math.min(i + BATCH_SIZE, files.length)} / ${files.length}…`);
				await new Promise(resolve => window.setTimeout(resolve, 0));
			}
		} finally {
			matcher.dispose();
		}

		this.report(files.length, chars, enumerateMs, readMs, matchMs, renderMs);
	}

	private appendHits(results: { path: string; matches: VaultHit['matches'] }[], batch: TFile[]): void {
		for (const result of results) {
			const file = batch.find(f => f.path === result.path);
			const hit: VaultHit = {
				path: result.path,
				matchCount: result.matches.length,
				matches: result.matches,
				selected: true,
				mtime: file?.stat.mtime ?? 0
			};
			this.hits.push(hit);
			this.renderRow(hit);
		}
	}

	private renderRow(hit: VaultHit): void {
		const row = this.resultsEl.createDiv({ cls: 'regex-replace-vault-file' });
		const header = row.createDiv({ cls: 'regex-replace-vault-file-header' });
		const box = header.createEl('input', { type: 'checkbox' });
		box.checked = true;
		box.addEventListener('change', () => {
			// Changing the selection invalidates a pending confirmation.
			this.resetConfirm();
			hit.selected = box.checked;
			this.applyButton.disabled = this.selected().length === 0;
			this.updateSelectionCount();
		});
		header.createSpan({ text: ` ${hit.path} — ${hit.matchCount} match(es)` });
		const body = row.createDiv({ cls: 'regex-replace-vault-file-body' });
		let rendered = false;
		header.addEventListener('click', (e) => {
			if ((e.target as HTMLElement).tagName === 'INPUT') return;
			row.toggleClass('is-expanded', !row.hasClass('is-expanded'));
			if (rendered) return;
			rendered = true;
			const list = body.createEl('ol', { cls: 'regex-replace-match-list' });
			for (const match of hit.matches) {
				list.createEl('li', { cls: 'regex-replace-match-text', text: match.text });
			}
		});
	}

	private selected(): VaultHit[] {
		return this.hits.filter(hit => hit.selected);
	}

	private updateSelectionCount(): void {
		const chosen = this.selected();
		const matches = chosen.reduce((sum, hit) => sum + hit.matchCount, 0);
		this.statusEl.setText(`${matches} match(es) in ${chosen.length} selected file(s)`);
	}

	private report(files: number, chars: number, enumerateMs: number, readMs: number, matchMs: number, renderMs: number): void {
		this.updateSelectionCount();
		if (this.cancelled) {
			this.metricsEl.createDiv({ text: 'cancelled — results below are partial' });
		}
		const lines = [
			`files scanned: ${files} (${chars.toLocaleString()} chars)`,
			`enumerate: ${enumerateMs.toFixed(1)} ms`,
			`cachedRead: ${readMs.toFixed(1)} ms`,
			`worker match: ${matchMs.toFixed(1)} ms`,
			`render: ${renderMs.toFixed(1)} ms`
		];
		for (const line of lines) {
			this.metricsEl.createDiv({ text: line });
		}
	}

	// Two clicks rather than a confirm() dialog: the count has to be read
	// somewhere, and a browser modal is both against the plugin guidelines and
	// unreliable on mobile.
	private async onApplyClick(): Promise<void> {
		const chosen = this.selected();
		if (chosen.length === 0) return;
		const matches = chosen.reduce((sum, hit) => sum + hit.matchCount, 0);

		if (!this.awaitingConfirm) {
			this.awaitingConfirm = true;
			this.applyButton.setText(`Confirm — replace in ${chosen.length} file(s)`);
			this.applyButton.addClass('mod-warning');
			this.statusEl.setText(`About to change ${matches} match(es) in ${chosen.length} file(s). Click again to apply.`);
			return;
		}
		this.resetConfirm();

		this.applyButton.disabled = true;
		this.scanButton.disabled = true;
		this.statusEl.setText('Applying…');
		try {
			const outcome = await applyVaultReplace(this.app, {
				hits: chosen,
				pattern: this.patternInput.value,
				flags: this.flagsInput.value,
				replacement: this.replacementInput.value,
				skipFrontmatter: this.frontmatterCheckbox.checked,
				saveReceipt: (receipt: ApplyReceipt) => this.plugin.saveVaultReceipt(receipt)
			});
			this.reportApply(outcome);
		} catch (e) {
			new Notice(`Replace failed: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			this.scanButton.disabled = false;
		}
	}

	private resetConfirm(): void {
		this.awaitingConfirm = false;
		this.applyButton.setText('Apply');
		this.applyButton.removeClass('mod-warning');
	}

	private reportApply(outcome: Awaited<ReturnType<typeof applyVaultReplace>>): void {
		this.statusEl.setText(`Replaced ${outcome.matches} match(es) in ${outcome.changed} file(s)`);
		this.metricsEl.createDiv({ text: `snapshot: ${outcome.snapshotMs.toFixed(1)} ms` });
		this.metricsEl.createDiv({ text: `write: ${outcome.writeMs.toFixed(1)} ms` });
		for (const skip of outcome.skipped.slice(0, 10)) {
			this.metricsEl.createDiv({ text: `skipped ${skip.path} — ${skip.reason}` });
		}
		if (outcome.skipped.length > 10) {
			this.metricsEl.createDiv({ text: `…and ${outcome.skipped.length - 10} more skipped` });
		}
		for (const fail of outcome.failed.slice(0, 10)) {
			this.metricsEl.createDiv({ text: `failed ${fail.path} — ${fail.error}` });
		}
		new Notice(`Replaced in ${outcome.changed} file(s). Undo with "Undo last vault replace".`);
	}

	onClose(): void {
		this.cancelled = true;
		this.contentEl.empty();
	}
}
