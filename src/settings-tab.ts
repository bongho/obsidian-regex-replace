import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { parsePipelineRuleset } from './engine';
import type RegexReplacePlugin from '../main';

export class RegexReplaceSettingTab extends PluginSettingTab {
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

		this.displayRuleSets(containerEl);
	}

	private displayRuleSets(containerEl: HTMLElement): void {
		containerEl.createEl('h3', { text: 'Pipeline rulesets' });
		containerEl.createEl('p', {
			text: 'Each ruleset is a list of rules applied in sequence. Use regex-pipeline syntax: "SEARCH"->"REPLACE" (optional inline flags, e.g. "SEARCH"gi->"REPLACE"), one rule per block.',
			cls: 'setting-item-description'
		});

		const ruleSets = this.plugin.settings.ruleSets;

		ruleSets.forEach((rs, index) => {
			const setting = new Setting(containerEl)
				.addText(text => text
					.setPlaceholder('Ruleset name')
					.setValue(rs.name)
					.onChange(async (value) => {
						rs.name = value;
						await this.plugin.saveSettings();
					}))
				.addButton(button => button
					.setButtonText('Delete')
					.setWarning()
					.onClick(async () => {
						ruleSets.splice(index, 1);
						await this.plugin.saveSettings();
						this.display();
					}));
			setting.infoEl.remove();

			const area = containerEl.createEl('textarea', {
				cls: 'regex-replace-ruleset-textarea'
			});
			area.value = rs.source;
			area.rows = 5;
			area.placeholder = '"foo"->"bar"\n"\\s+"->" "';
			area.addEventListener('change', async () => {
				rs.source = area.value;
				rs.rules = parsePipelineRuleset(area.value);
				await this.plugin.saveSettings();
				new Notice(`Ruleset "${rs.name}": ${rs.rules.length} rule(s) parsed`);
			});
		});

		new Setting(containerEl)
			.addButton(button => button
				.setButtonText('Add ruleset')
				.setCta()
				.onClick(async () => {
					ruleSets.push({ name: `Ruleset ${ruleSets.length + 1}`, source: '', rules: [] });
					await this.plugin.saveSettings();
					this.display();
				}))
			.addButton(button => button
				.setButtonText('Import from regex-pipeline')
				.onClick(() => { void this.importFromRegexPipeline(); }));
	}

	// Reads regex-pipeline ruleset files from `<configDir>/regex-rulesets/`,
	// converts each into a native RuleSet, and appends them. index.txt is skipped.
	private async importFromRegexPipeline(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const dir = `${this.app.vault.configDir}/regex-rulesets`;

		if (!(await adapter.exists(dir))) {
			new Notice(`No regex-pipeline folder found at ${dir}`);
			return;
		}

		const listing = await adapter.list(dir);
		const ruleFiles = listing.files.filter(
			f => f.endsWith('.txt') && !f.endsWith('/index.txt')
		);

		let imported = 0;
		for (const file of ruleFiles) {
			try {
				const content = await adapter.read(file);
				const rules = parsePipelineRuleset(content);
				if (rules.length === 0) continue;
				const name = (file.split('/').pop() ?? file).replace(/\.txt$/, '');
				this.plugin.settings.ruleSets.push({ name, source: content, rules });
				imported++;
			} catch (e) {
				new Notice(`Failed to read ${file}: ${e}`);
			}
		}

		await this.plugin.saveSettings();
		new Notice(`Imported ${imported} ruleset(s) from regex-pipeline`);
		this.display();
	}
}
