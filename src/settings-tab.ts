import { App, Notice, PluginSettingTab, Setting, SettingDefinitionItem } from 'obsidian';
import { parsePipelineRuleset } from './engine';
import type RegexReplacePlugin from '../main';

const RULESET_DESC = 'Each ruleset is a list of rules applied in sequence. Use regex-pipeline syntax: "SEARCH"->"REPLACE" (optional inline flags, e.g. "SEARCH"gi->"REPLACE"), one rule per block.';
const RULESET_PLACEHOLDER = '"foo"->"bar"\n"\\s+"->" "';

// Keys for the ruleset controls in the declarative path. Ruleset fields live
// inside an array, so they need composite keys resolved by
// get/setControlValue rather than a plain settings property name.
const RULESET_KEY = /^ruleSets\.(\d+)\.(name|source)$/;

export class RegexReplaceSettingTab extends PluginSettingTab {
    plugin: RegexReplacePlugin;

    constructor(app: App, plugin: RegexReplacePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    // Obsidian <1.13 has no declarative settings API, so it never calls
    // getSettingDefinitions() and renders display() instead. Keeping both
    // lets manifest.minAppVersion stay at 0.15.0.
    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Default flags')
            .setDesc('Default regex flags (g=global, i=ignore case, m=multiline)')
            .addText(text => text
                .setPlaceholder('Enter flags')
                .setValue(this.plugin.settings.defaultFlags)
                .onChange(value => { void this.setControlValue('defaultFlags', value); }));

        new Setting(containerEl)
            .setName('Show preview')
            .setDesc('Show before/after preview in the replace dialog')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showPreview)
                .onChange(value => { void this.setControlValue('showPreview', value); }));

        new Setting(containerEl)
            .setName('History limit')
            .setDesc('Maximum number of recent patterns to remember')
            .addSlider(slider => slider
                .setLimits(0, 50, 5)
                .setValue(this.plugin.settings.historyLimit)
                .setDynamicTooltip()
                .onChange(value => { void this.setControlValue('historyLimit', value); }));

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

        new Setting(containerEl)
            .setName('Pipeline rulesets')
            .setDesc(RULESET_DESC)
            .setHeading();

        const ruleSets = this.plugin.settings.ruleSets;
        if (ruleSets.length === 0) {
            containerEl.createEl('p', { text: 'No rulesets yet.' });
        }

        ruleSets.forEach((rs, index) => {
            new Setting(containerEl)
                .setName(rs.name || `Ruleset ${index + 1}`)
                .setDesc(`${rs.rules.length} rule(s)`)
                .addText(text => text
                    .setPlaceholder('Ruleset name')
                    .setValue(rs.name)
                    .onChange(value => { void this.setControlValue(`ruleSets.${index}.name`, value); }))
                .addExtraButton(button => button
                    .setIcon('trash')
                    .setTooltip('Delete ruleset')
                    .onClick(() => {
                        ruleSets.splice(index, 1);
                        void this.plugin.saveSettings();
                        this.refresh();
                    }));

            new Setting(containerEl)
                .setName('Rules')
                .setDesc(RULESET_DESC)
                .addTextArea(area => {
                    area.setPlaceholder(RULESET_PLACEHOLDER)
                        .setValue(rs.source)
                        .onChange(value => { void this.setControlValue(`ruleSets.${index}.source`, value); });
                    area.inputEl.rows = 5;
                });
        });

        new Setting(containerEl)
            .addButton(button => button
                .setButtonText('Add ruleset')
                .onClick(() => {
                    ruleSets.push({ name: `Ruleset ${ruleSets.length + 1}`, source: '', rules: [] });
                    void this.plugin.saveSettings();
                    this.refresh();
                }));

        new Setting(containerEl)
            .setName('Import from regex-pipeline')
            .setDesc(`Reads ruleset files from ${this.app.vault.configDir}/regex-rulesets/`)
            .addButton(button => button
                .setButtonText('Import')
                .onClick(() => { void this.importFromRegexPipeline(); }));
    }

    // update() only exists on 1.13+; older builds re-render via display().
    private refresh(): void {
        if (typeof this.update === 'function') {
            this.update();
        } else {
            this.display();
        }
    }

    // Declarative settings (Obsidian 1.13.0+). Returning a non-empty array
    // makes Obsidian render the tab from these definitions and index them
    // for settings search; on 1.13+ display() below is never called.
    getSettingDefinitions(): SettingDefinitionItem[] {
        const ruleSets = this.plugin.settings.ruleSets;

        return [
            {
                name: 'Default flags',
                desc: 'Default regex flags (g=global, i=ignore case, m=multiline)',
                control: { type: 'text', key: 'defaultFlags', placeholder: 'Enter flags' }
            },
            {
                name: 'Show preview',
                desc: 'Show before/after preview in the replace dialog',
                control: { type: 'toggle', key: 'showPreview' }
            },
            {
                name: 'History limit',
                desc: 'Maximum number of recent patterns to remember',
                control: { type: 'slider', key: 'historyLimit', min: 0, max: 50, step: 5 }
            },
            {
                name: 'Clear history',
                desc: 'Remove all saved patterns from history',
                // A button, not a click-anywhere row: clearing history is
                // destructive and should need a deliberate hit.
                render: (setting: Setting) => {
                    setting.addButton(button => button
                        .setButtonText('Clear')
                        .onClick(() => {
                            this.plugin.settings.recentPatterns = [];
                            void this.plugin.saveSettings();
                            new Notice('History cleared');
                        }));
                }
            },
            {
                name: 'Pipeline rulesets',
                desc: RULESET_DESC
            },
            {
                type: 'list',
                emptyState: 'No rulesets yet.',
                items: ruleSets.map((rs, index) => ({
                    type: 'page' as const,
                    name: rs.name || `Ruleset ${index + 1}`,
                    desc: `${rs.rules.length} rule(s)`,
                    items: [
                        {
                            name: 'Name',
                            control: {
                                type: 'text' as const,
                                key: `ruleSets.${index}.name`,
                                placeholder: 'Ruleset name'
                            }
                        },
                        {
                            name: 'Rules',
                            desc: RULESET_DESC,
                            control: {
                                type: 'textarea' as const,
                                key: `ruleSets.${index}.source`,
                                placeholder: RULESET_PLACEHOLDER,
                                rows: 5
                            }
                        }
                    ]
                })),
                onDelete: (index: number) => {
                    ruleSets.splice(index, 1);
                    void this.plugin.saveSettings();
                    this.refresh();
                },
                addItem: {
                    name: 'Add ruleset',
                    action: () => {
                        ruleSets.push({ name: `Ruleset ${ruleSets.length + 1}`, source: '', rules: [] });
                        void this.plugin.saveSettings();
                        this.refresh();
                    }
                }
            },
            {
                name: 'Import from regex-pipeline',
                desc: `Reads ruleset files from ${this.app.vault.configDir}/regex-rulesets/`,
                render: (setting: Setting) => {
                    setting.addButton(button => button
                        .setButtonText('Import')
                        .onClick(() => { void this.importFromRegexPipeline(); }));
                }
            }
        ];
    }

    getControlValue(key: string): unknown {
        const match = RULESET_KEY.exec(key);
        if (match) {
            const rs = this.plugin.settings.ruleSets[Number(match[1])];
            return rs ? rs[match[2] as 'name' | 'source'] : '';
        }

        switch (key) {
            case 'defaultFlags':
                return this.plugin.settings.defaultFlags;
            case 'showPreview':
                return this.plugin.settings.showPreview;
            case 'historyLimit':
                return this.plugin.settings.historyLimit;
            default:
                return undefined;
        }
    }

    async setControlValue(key: string, value: unknown): Promise<void> {
        const settings = this.plugin.settings;

        const match = RULESET_KEY.exec(key);
        if (match && typeof value === 'string') {
            const rs = settings.ruleSets[Number(match[1])];
            if (!rs) return;
            if (match[2] === 'name') {
                // The page title picks the new name up on the next render;
                // calling update() here would rebuild the DOM mid-typing.
                rs.name = value;
            } else {
                rs.source = value;
                rs.rules = parsePipelineRuleset(value);
                await this.plugin.saveSettings();
                new Notice(`Ruleset "${rs.name}": ${rs.rules.length} rule(s) parsed`);
                return;
            }
        } else if (key === 'defaultFlags' && typeof value === 'string') {
            // Silently drop anything that is not a supported flag.
            settings.defaultFlags = value.replace(/[^gim]/g, '');
        } else if (key === 'showPreview' && typeof value === 'boolean') {
            settings.showPreview = value;
        } else if (key === 'historyLimit' && typeof value === 'number') {
            settings.historyLimit = value;
            settings.recentPatterns = settings.recentPatterns.slice(0, value);
        } else {
            return;
        }

        await this.plugin.saveSettings();
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
                new Notice(`Failed to read ${file}: ${String(e)}`);
            }
        }

        await this.plugin.saveSettings();
        new Notice(`Imported ${imported} ruleset(s) from regex-pipeline`);
        this.refresh();
    }
}
