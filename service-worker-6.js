console.log("[Browser Link][Worker] Started: VS Code port=9998");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	console.log(`[Browser Link][Worker] Message: action=${message.action}, url=${message.url}, sender=${sender.url}, senderId=${sender.id}, tab=${sender.tab?.id}, frame=${sender.frameId}`);
	if (sender.id !== chrome.runtime.id || message.action !== "open" || !sender.tab || sender.frameId !== 0) return;
	if (message.editor && message.editor !== "vscode") {
		sendResponse({ ok: false, error: "Only VS Code is supported." });
		return;
	}
	const editorName = "VS Code";
	const bridgeUrl = "http://127.0.0.1:9998";
	(async () => {
		try {
			const pageUrl = new URL(sender.url);
			const resourceUrl = new URL(message.url);
			if (!["http:", "https:"].includes(resourceUrl.protocol) || resourceUrl.origin !== pageUrl.origin) {
				throw new Error("Only files from the current website can be mapped to the local project.");
			}
			const payload = { url: message.url };

			let response;
			try {
				console.log(`[Browser Link][Worker] Sending POST ${bridgeUrl}/${message.action}: url=${message.url}`);
				response = await fetch(`${bridgeUrl}/open`, {
					method: "POST",
					headers: { "Content-Type": "application/json", "X-Browser-Link": "1" },
					body: JSON.stringify(payload),
					signal: AbortSignal.timeout(10000)
				});
			} catch (error) {
				console.error(`[Browser Link][Worker] Fetch failed: ${error.stack || error.message || error}`);
				throw new Error(`Unable to communicate with ${editorName}.`);
			}
			console.log(`[Browser Link][Worker] HTTP response: status=${response.status}, type=${response.headers.get("content-type")}`);
			let result;
			try {
				result = await response.json();
			} catch {
				throw new Error("The local server did not return a valid Browser Link response.");
			}
			if (!response.ok || !result.ok) throw new Error(result.error || `${editorName} could not complete the request.`);
			console.log(`[Browser Link][Worker] Request succeeded: path=${result.projectPath}, exists=${result.exists}`);
			sendResponse(result);
		} catch (error) {
			console.error(`[Browser Link][Worker] Request failed: action=${message.action}, url=${message.url}, error=${error.stack || error.message || error}`);
			const result = { ok: false, error: error.message };
			sendResponse(result);
		}
	})();
	return true;
});
