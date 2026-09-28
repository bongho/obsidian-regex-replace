import { VaultMatchInfo } from './types';
import { MATCH_WORKER_SOURCE } from './match-worker';

export interface FileMatches {
	path: string;
	matches: VaultMatchInfo[];
}

export interface MatchPayload {
	path: string;
	text: string;
	offset: number;
}

// A live worker. `run` matches one batch; the caller decides how batches are
// produced, which is what lets the scan interleave reading and matching instead
// of reading the whole vault first.
export interface Matcher {
	run(files: MatchPayload[]): Promise<FileMatches[]>;
	dispose(): void;
}

type WorkerMessage =
	| { type: 'ready' }
	| { type: 'error'; message: string }
	| { type: 'batchDone'; results: FileMatches[] };

// Creates the worker and completes its handshake. Rejects rather than resolving
// a half-working matcher: a regex that backtracks cannot be interrupted on the
// thread running it, so a caller without a live worker has no safe way to match.
export function createMatcher(pattern: string, flags: string, timeoutMs: number): Promise<Matcher> {
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

		let settle: ((msg: WorkerMessage) => void) | null = null;
		let fail: ((error: Error) => void) | null = null;
		let watchdog = 0;
		let disposed = false;

		const dispose = (): void => {
			if (disposed) return;
			disposed = true;
			window.clearTimeout(watchdog);
			worker.terminate();
			URL.revokeObjectURL(url);
		};

		const arm = (message: string): void => {
			watchdog = window.setTimeout(() => {
				const onFail = fail;
				dispose();
				onFail?.(new Error(message));
			}, timeoutMs);
		};

		worker.onmessage = (e: MessageEvent) => {
			window.clearTimeout(watchdog);
			const msg = e.data as WorkerMessage;
			if (msg.type === 'error') {
				const onFail = fail;
				dispose();
				onFail?.(new Error(msg.message));
				return;
			}
			settle?.(msg);
		};

		worker.onerror = (e: ErrorEvent) => {
			const onFail = fail;
			dispose();
			onFail?.(new Error(e.message || 'The matching worker failed'));
		};

		// The handshake needs its own watchdog. A worker that is constructed but
		// never runs — a blocked blob: script, for one — would otherwise leave
		// this pending forever, which reads as a frozen dialog, not a refusal.
		settle = () => {
			resolve({
				run: (files) => new Promise<FileMatches[]>((res, rej) => {
					if (disposed) {
						rej(new Error('The matching worker was stopped'));
						return;
					}
					settle = (msg) => {
						res(msg.type === 'batchDone' ? msg.results : []);
					};
					fail = rej;
					arm(
						`Matching stopped after ${timeoutMs}ms at "${files[0]?.path ?? '?'}". ` +
						'The pattern is too slow to run across the vault.'
					);
					worker.postMessage({ type: 'batch', files });
				}),
				dispose
			});
		};
		fail = reject;
		arm('The matching worker did not start. Vault scanning is not available here.');
		worker.postMessage({ type: 'init', pattern, flags });
	});
}
