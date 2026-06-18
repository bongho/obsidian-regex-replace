import { Editor, MarkdownView, Plugin } from 'obsidian';
import { RegexReplaceSettings, PatternHistory, DEFAULT_SETTINGS } from './src/types';
import { ReplaceModal } from './src/replace-modal';
import { PipelineModal } from './src/pipeline-modal';
import { RegexReplaceSettingTab } from './src/settings-tab';

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
