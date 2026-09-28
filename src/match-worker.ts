// The worker body, kept as a string because esbuild bundles the plugin into a
// single main.js — there is no second file for the worker to load. It is turned
// into a Blob URL at runtime by vault-match.ts.
//
// Why a worker at all: a regex that backtracks cannot be interrupted on the
// thread running it, so yielding between files does not help. Only a separate
// thread can be killed, which is what the main thread's watchdog does.
export const MATCH_WORKER_SOURCE = `
let regex = null;

self.onmessage = function (e) {
	const msg = e.data;

	if (msg.type === 'init') {
		try {
			const flags = msg.flags.indexOf('g') === -1 ? msg.flags + 'g' : msg.flags;
			regex = new RegExp(msg.pattern, flags);
		} catch (err) {
			self.postMessage({ type: 'error', message: String(err) });
			return;
		}
		self.postMessage({ type: 'ready' });
		return;
	}

	if (msg.type === 'batch') {
		const results = [];
		for (const file of msg.files) {
			regex.lastIndex = 0;
			const matches = [];
			let m;
			while ((m = regex.exec(file.text)) !== null) {
				matches.push({
					index: m.index + file.offset,
					length: m[0].length,
					text: m[0]
				});
				if (m.index === regex.lastIndex) regex.lastIndex++;
			}
			if (matches.length > 0) {
				results.push({ path: file.path, matches: matches });
			}
		}
		self.postMessage({ type: 'batchDone', results: results });
	}
};
`;
