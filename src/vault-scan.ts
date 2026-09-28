import { App, TFile } from 'obsidian';

// Minimal glob for the exclude setting, matched against the vault-relative
// path: `*` inside a segment, `**` across segments, `?` for one character.
export function globToRegExp(pattern: string): RegExp {
	let out = '';
	for (let i = 0; i < pattern.length; i++) {
		const c = pattern[i];
		if (c === '*' && pattern[i + 1] === '*') {
			// `**/` swallows its own separator, so `a/**/b` still matches `a/b`.
			if (pattern[i + 2] === '/') {
				out += '(?:[^/]+/)*';
				i += 2;
			} else {
				out += '.*';
				i += 1;
			}
		} else if (c === '*') {
			out += '[^/]*';
		} else if (c === '?') {
			out += '[^/]';
		} else {
			out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		}
	}
	return new RegExp(`^${out}$`);
}

const GLOB_CHARS = /[*?]/;

// A pattern without a glob character also covers everything beneath it, so
// "Archive" excludes "Archive/2020/note.md" without the user writing "**".
export function isExcluded(path: string, patterns: string[]): boolean {
	return patterns.some(raw => {
		const pattern = raw.trim().replace(/\/+$/, '');
		if (!pattern) return false;
		if (!GLOB_CHARS.test(pattern)) {
			return path === pattern || path.startsWith(`${pattern}/`);
		}
		return globToRegExp(pattern).test(path);
	});
}

export function parseExcludeGlobs(source: string): string[] {
	return source.split('\n').map(line => line.trim()).filter(line => line.length > 0);
}

// Hidden folders never appear here — Obsidian does not index them — so the
// exclude list only has to cover folders the user can actually see.
export function collectFiles(app: App, folder: string, excludes: string[]): TFile[] {
	const prefix = folder.trim().replace(/\/+$/, '');
	return app.vault.getMarkdownFiles()
		.filter(file => !prefix || file.path.startsWith(`${prefix}/`))
		.filter(file => !isExcluded(file.path, excludes));
}

// Where matching starts in a file. Read from the metadata cache rather than
// parsing `---`, which would take a horizontal rule in the body for frontmatter.
export function frontmatterOffset(app: App, file: TFile, skipFrontmatter: boolean): number {
	if (!skipFrontmatter) return 0;
	return app.metadataCache.getFileCache(file)?.frontmatterPosition?.end.offset ?? 0;
}
