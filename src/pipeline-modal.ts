import { App, Editor, Modal, Notice } from 'obsidian';
import { RegexEngine } from './engine';
import { RuleSet } from './types';
import type RegexReplacePlugin from '../main';

export class PipelineModal extends Modal {
	private plugin: RegexReplacePlugin;
	private editor: Editor;
	private selected: RuleSet | null = null;
	private selectionOnly = false;
	private previewEl: HTMLElement;

	constructor(app: App, plugin: RegexReplacePlugin, editor: Editor) {
		super(app);
		this.plugin = plugin;
		this.editor = editor;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('regex-replace-modal');
		contentEl.createEl('h2', { text: 'Apply ruleset (pipeline)' });

		const ruleSets = this.plugin.settings.ruleSets;
		if (ruleSets.length === 0) {
			contentEl.createEl('p', {
				text: 'No rulesets defined. Add one in the plugin settings, or import from regex-pipeline.'
			});
			const close = contentEl.createEl('button', { text: 'Close' });
			close.addEventListener('click', () => this.close());
			return;
		}

		this.createRuleSetSelector(contentEl, ruleSets);
		this.createSelectionOption(contentEl);
		const previewContainer = contentEl.createDiv({ cls: 'regex-replace-preview-container' });
		previewContainer.createEl('label', { text: 'Pipeline preview' });
		this.previewEl = previewContainer.createDiv({ cls: 'regex-replace-preview' });
		this.createButtons(contentEl);

		this.selected = ruleSets[0];
		this.updatePreview();
	}

	private createRuleSetSelector(container: HTMLElement, ruleSets: RuleSet[]): void {
		const wrapper = container.createDiv({ cls: 'regex-replace-history' });
		wrapper.createEl('label', { text: 'Ruleset' });
		const select = wrapper.createEl('select', { cls: 'regex-replace-history-select' });
		ruleSets.forEach((rs, index) => {
			select.createEl('option', {
				text: `${rs.name} (${rs.rules.length} rule${rs.rules.length === 1 ? '' : 's'})`,
				value: String(index)
			});
		});
		select.addEventListener('change', (e) => {
			const index = parseInt((e.target as HTMLSelectElement).value);
			this.selected = ruleSets[index] ?? null;
			this.updatePreview();
		});
	}

	private createSelectionOption(container: HTMLElement): void {
		const field = container.createDiv({ cls: 'regex-replace-field' });
		const label = field.createEl('label', { cls: 'regex-replace-flag-label' });
		const checkbox = label.createEl('input', { type: 'checkbox' });
		label.appendText(' Apply to selection only');
		checkbox.addEventListener('change', (e) => {
			this.selectionOnly = (e.target as HTMLInputElement).checked;
			this.updatePreview();
		});
	}

	private getText(): string {
		if (this.selectionOnly) {
			return this.editor.getSelection() || this.editor.getValue();
		}
		return this.editor.getValue();
	}

	private updatePreview(): void {
		this.previewEl.empty();
		if (!this.selected || this.selected.rules.length === 0) {
			this.previewEl.setText('This ruleset has no rules.');
			return;
		}

		const steps = RegexEngine.previewPipeline(this.getText(), this.selected.rules);
		const list = this.previewEl.createEl('ol', { cls: 'regex-replace-pipeline-steps' });
		for (const step of steps) {
			const li = list.createEl('li', { cls: 'regex-replace-pipeline-step' });
			li.createEl('code', { text: step.search });
			if (step.error) {
				li.createSpan({ text: ` — error: ${step.error}`, cls: 'regex-replace-error' });
			} else {
				li.createSpan({ text: ` — ${step.matchCount} match(es)` });
			}
		}

		const final = steps.length ? steps[steps.length - 1].after : this.getText();
		const finalDiv = this.previewEl.createDiv({ cls: 'regex-replace-preview-replaced' });
		finalDiv.createEl('strong', { text: 'Result: ' });
		finalDiv.createEl('div', {
			text: final.length > 1000 ? final.substring(0, 1000) + '...' : final,
			cls: 'regex-replace-highlight-content'
		});
	}

	private createButtons(container: HTMLElement): void {
		const buttonContainer = container.createDiv({ cls: 'regex-replace-buttons' });
		const apply = buttonContainer.createEl('button', { text: 'Apply pipeline', cls: 'mod-cta' });
		apply.addEventListener('click', () => this.applyPipeline());
		const cancel = buttonContainer.createEl('button', { text: 'Cancel' });
		cancel.addEventListener('click', () => this.close());
	}

	private applyPipeline(): void {
		if (!this.selected || this.selected.rules.length === 0) {
			new Notice('Select a ruleset with at least one rule');
			return;
		}

		const text = this.getText();
		const { result, warnings } = RegexEngine.executePipeline(text, this.selected.rules);

		if (this.selectionOnly && this.editor.getSelection()) {
			this.editor.replaceSelection(result);
		} else {
			const cursor = this.editor.getCursor();
			this.editor.setValue(result);
			this.editor.setCursor(cursor);
		}

		if (warnings.length > 0) {
			new Notice(`Applied "${this.selected.name}" with ${warnings.length} skipped rule(s):\n${warnings.join('\n')}`);
		} else {
			new Notice(`Applied ruleset "${this.selected.name}" (${this.selected.rules.length} rules)`);
		}
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
