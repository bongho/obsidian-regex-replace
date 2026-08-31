// Mirrors the ruleset the Obsidian plugin review runs, so findings show up
// here instead of on a published release. See CONTRIBUTING.md.
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
	{
		ignores: ['node_modules/', 'main.js', 'test.js'],
	},
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					// Files outside tsconfig's include: the build/release scripts and
					// the standalone test harness.
					allowDefaultProject: [
						'eslint.config.mjs',
						'esbuild.config.mjs',
						'version-bump.mjs',
						'test.ts',
					],
				},
			},
		},
	},
	{
		// Build scripts and the standalone test harness are not shipped to
		// users, so the mobile-safety and console rules do not apply to them.
		files: ['esbuild.config.mjs', 'version-bump.mjs', 'test.ts'],
		languageOptions: {
			globals: { process: 'readonly' },
		},
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
			'obsidianmd/rule-custom-message': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
		},
	},
]);
