import { Editor, MarkdownView, Plugin, Notice } from 'obsidian';
import { RegexReplaceSettings, PatternHistory, DEFAULT_SETTINGS } from './src/types';
import { ReplaceModal } from './src/replace-modal';
import { PipelineModal } from './src/pipeline-modal';
import { RegexReplaceSettingTab } from './src/settings-tab';
import { RegexEngine } from './src/engine';

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

		this.addCommand({
			id: 'apply-ruleset',
			name: 'Apply ruleset (pipeline)',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				new PipelineModal(this.app, this, editor).open();
			}
		});

		this.registerDynamicRuleSetCommands();

		this.addSettingTab(new RegexReplaceSettingTab(this.app, this));
	}

	private registerDynamicRuleSetCommands(): void {
		// Register a command for each ruleset, allowing direct invocation
		// from Commander, Editing Toolbar, or other plugins.
		this.settings.ruleSets.forEach((ruleset, index) => {
			this.addCommand({
				id: `ruleset-${index}`,
				name: `Ruleset: ${ruleset.name}`,
				editorCallback: (editor: Editor) => {
					this.applyRuleSetByIndex(editor, index);
				}
			});
		});
	}

	private applyRuleSetByIndex(editor: Editor, index: number): void {
		const ruleset = this.settings.ruleSets[index];
		if (!ruleset) {
			new Notice('Ruleset not found');
			return;
		}

		if (ruleset.rules.length === 0) {
			new Notice(`Ruleset "${ruleset.name}" has no rules`);
			return;
		}

		const text = editor.getValue();
		const { result, warnings } = RegexEngine.executePipeline(text, ruleset.rules);

		const cursor = editor.getCursor();
		editor.setValue(result);
		editor.setCursor(cursor);

		if (warnings.length > 0) {
			new Notice(`Applied "${ruleset.name}" with ${warnings.length} skipped rule(s):\n${warnings.join('\n')}`);
		} else {
			new Notice(`Applied ruleset "${ruleset.name}" (${ruleset.rules.length} rules)`);
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()) as RegexReplaceSettings;
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
