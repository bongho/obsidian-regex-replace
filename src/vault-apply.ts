import { App, TFile } from 'obsidian';
import { ApplyReceipt, ReceiptEntry, VaultHit, hashText } from './types';
import { RegexEngine } from './engine';
import { frontmatterOffset } from './vault-scan';

export interface ApplyOutcome {
	changed: number;
	matches: number;
	skipped: { path: string; reason: string }[];
	failed: { path: string; error: string }[];
	snapshotMs: number;
	writeMs: number;
}

export interface ApplyRequest {
	hits: VaultHit[];
	pattern: string;
	flags: string;
	replacement: string;
	skipFrontmatter: boolean;
	// Persists the receipt. Called once, before any file is written, so an undo
	// exists for every write that follows.
	saveReceipt: (receipt: ApplyReceipt) => Promise<void>;
}

// Replaces in the selected files. Reads every file again first: a file edited
// between the scan and now would otherwise be rewritten against stale matches.
export async function applyVaultReplace(app: App, req: ApplyRequest): Promise<ApplyOutcome> {
	const skipped: { path: string; reason: string }[] = [];
	const failed: { path: string; error: string }[] = [];
	const entries: ReceiptEntry[] = [];
	const writes: { file: TFile; before: string; after: string }[] = [];

	const snapshotStart = performance.now();
	for (const hit of req.hits) {
		const file = app.vault.getFileByPath(hit.path);
		if (!file) {
			skipped.push({ path: hit.path, reason: 'no longer in the vault' });
			continue;
		}
		if (file.stat.mtime !== hit.mtime) {
			skipped.push({ path: hit.path, reason: 'edited since the scan' });
			continue;
		}

		const before = await app.vault.cachedRead(file);
		const offset = frontmatterOffset(app, file, req.skipFrontmatter);
		const body = offset ? before.slice(offset) : before;
		const result = RegexEngine.execute(body, req.pattern, req.replacement, req.flags);
		if (typeof result === 'object' && 'error' in result) {
			failed.push({ path: hit.path, error: result.error });
			continue;
		}
		const after = offset ? before.slice(0, offset) + result : result;
		if (after === before) {
			skipped.push({ path: hit.path, reason: 'replacement changes nothing' });
			continue;
		}

		entries.push({ path: hit.path, before, afterHash: hashText(after), matchCount: hit.matchCount });
		writes.push({ file, before, after });
	}

	await req.saveReceipt({
		startedAt: Date.now(),
		pattern: req.pattern,
		flags: req.flags,
		replacement: req.replacement,
		files: entries
	});
	const snapshotMs = performance.now() - snapshotStart;

	const writeStart = performance.now();
	let changed = 0;
	let matches = 0;
	for (const write of writes) {
		try {
			let raced = false;
			// process() hands us the file as it is at write time. Comparing here
			// closes the last gap: anything that landed since the read above is
			// left alone rather than overwritten.
			await app.vault.process(write.file, (data) => {
				if (data !== write.before) {
					raced = true;
					return data;
				}
				return write.after;
			});
			if (raced) {
				skipped.push({ path: write.file.path, reason: 'edited during the run' });
				continue;
			}
			changed++;
			matches += entries.find(e => e.path === write.file.path)?.matchCount ?? 0;
		} catch (e) {
			failed.push({ path: write.file.path, error: String(e) });
		}
	}

	return { changed, matches, skipped, failed, snapshotMs, writeMs: performance.now() - writeStart };
}

export interface UndoOutcome {
	restored: number;
	skipped: { path: string; reason: string }[];
	failed: { path: string; error: string }[];
}

// Puts each file back to its `before`, but only where the current content still
// hashes to what the run wrote. A file touched since then is left alone.
export async function undoVaultReplace(app: App, receipt: ApplyReceipt): Promise<UndoOutcome> {
	const skipped: { path: string; reason: string }[] = [];
	const failed: { path: string; error: string }[] = [];
	let restored = 0;

	for (const entry of receipt.files) {
		const file = app.vault.getFileByPath(entry.path);
		if (!file) {
			skipped.push({ path: entry.path, reason: 'no longer in the vault' });
			continue;
		}
		try {
			let mismatched = false;
			await app.vault.process(file, (data) => {
				if (hashText(data) !== entry.afterHash) {
					mismatched = true;
					return data;
				}
				return entry.before;
			});
			if (mismatched) {
				skipped.push({ path: entry.path, reason: 'changed since the replace' });
				continue;
			}
			restored++;
		} catch (e) {
			failed.push({ path: entry.path, error: String(e) });
		}
	}

	return { restored, skipped, failed };
}
