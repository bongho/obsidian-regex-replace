import { MATCH_WORKER_SOURCE } from './match-worker';

export interface VaultMatch {
	index: number;
	length: number;
	text: string;
}

export interface FileMatches {
	path: string;
	matches: VaultMatch[];
}

export interface MatchPayload {
	path: string;
	text: string;
	offset: number;
}

export interface MatchRun {
	results: FileMatches[];
	matchMs: number;
}

// What the worker posts back. `e.data` is `any`, so this is the one place the
// shape is asserted; everything downstream is typed.
type WorkerMessage =
	| { type: 'ready' }
	| { type: 'error'; message: string }
	| { type: 'batchDone'; results: FileMatches[] };

// Files per postMessage. Small enough that the watchdog blames a narrow set of
// files when a pattern runs away, large enough to keep the message count down.
const BATCH_SIZE = 50;

// Runs the pattern over every payload in a worker, killing it if a batch stops
// reporting. Rejects rather than returning partial results: a half-scanned
// vault would make the match counts on screen a lie.
export function runVaultMatch(
	payloads: MatchPayload[],
	pattern: string,
	flags: string,
	timeoutMs: number,
	onProgress: (done: number, total: number) => void
): Promise<MatchRun> {
	return new Promise((resolve, reject) => {
		let worker: Worker;
		let url: string;
		try {
			const blob = new Blob([MATCH_WORKER_SOURCE], { type: 'application/javascript' });
			url = URL.createObjectURL(blob);
			worker = new Worker(url);
		} catch (e) {
			reject(new Error(`Could not start the matching worker: ${String(e)}`));
			return;
		}

		const results: FileMatches[] = [];
		const started = performance.now();
		let cursor = 0;
		let watchdog = 0;

		const finish = (settle: () => void): void => {
			window.clearTimeout(watchdog);
			worker.terminate();
			URL.revokeObjectURL(url);
			settle();
		};

		const sendNext = (): void => {
			if (cursor >= payloads.length) {
				const matchMs = performance.now() - started;
				finish(() => resolve({ results, matchMs }));
				return;
			}
			const batch = payloads.slice(cursor, cursor + BATCH_SIZE);
			cursor += batch.length;
			watchdog = window.setTimeout(() => {
				finish(() => reject(new Error(
					`Matching stopped after ${timeoutMs}ms at "${batch[0].path}". ` +
					'The pattern is too slow to run across the vault.'
				)));
			}, timeoutMs);
			worker.postMessage({ type: 'batch', files: batch });
		};

		worker.onmessage = (e: MessageEvent) => {
			window.clearTimeout(watchdog);
			const msg = e.data as WorkerMessage;
			if (msg.type === 'error') {
				finish(() => reject(new Error(msg.message)));
				return;
			}
			if (msg.type === 'ready') {
				sendNext();
				return;
			}
			if (msg.type === 'batchDone') {
				results.push(...msg.results);
				onProgress(cursor, payloads.length);
				sendNext();
			}
		};

		worker.onerror = (e: ErrorEvent) => {
			finish(() => reject(new Error(e.message || 'The matching worker failed')));
		};

		worker.postMessage({ type: 'init', pattern, flags });
	});
}
