const http = require("http");
const path = require("path");
const fs = require("fs/promises");
const { randomUUID } = require("crypto");
const vscode = require("vscode");

function activate(context) {
	for (const folder of vscode.workspace.workspaceFolders || []) updateDevToolsWorkspace(folder);
	context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders((event) => {
		for (const folder of event.added) updateDevToolsWorkspace(folder);
	}));
	context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => {
		for (const folder of vscode.workspace.workspaceFolders || []) updateDevToolsWorkspace(folder);
	}));
	console.log(`[Browser Link][VS Code] Activating: extension=${context.extensionPath}, folders=${JSON.stringify((vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.fsPath))}`);
	const server = http.createServer(async (request, response) => {
		const origin = request.headers.origin;
		console.log(`[Browser Link][VS Code] HTTP request: method=${request.method}, route=${request.url}, origin=${origin}`);
		if (!origin || !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
			console.error(`[Browser Link][VS Code] Request rejected: invalid origin=${origin}`);
			response.writeHead(403);
			response.end();
			return;
		}
		response.setHeader("Access-Control-Allow-Origin", origin);
		response.setHeader("Vary", "Origin");
		response.setHeader("Cache-Control", "no-store");
		if (request.method === "OPTIONS") {
			response.writeHead(204, {
				"Access-Control-Allow-Methods": "POST",
				"Access-Control-Allow-Headers": "Content-Type, X-Browser-Link"
			});
			response.end();
			return;
		}
		response.setHeader("Content-Type", "application/json; charset=utf-8");
		if (request.method !== "POST" || request.url !== "/open" || request.headers["x-browser-link"] !== "1") {
			console.error(`[Browser Link][VS Code] Request rejected: method=${request.method}, route=${request.url}, X-Browser-Link=${request.headers["x-browser-link"]}`);
			response.writeHead(400);
			response.end(JSON.stringify({ error: "Invalid Browser Link request." }));
			return;
		}

		try {
			const chunks = [];
			let size = 0;
			for await (const chunk of request) {
				size += chunk.length;
				if (size > 10 * 1024 * 1024) {
					throw new Error("The request exceeds the 10 MB limit.");
				}
				chunks.push(chunk);
			}
			const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			console.log(`[Browser Link][VS Code] Request parsed: action=${request.url}, url=${message.url}, bytes=${size}`);
			const result = await handleRequest(message);
			console.log(`[Browser Link][VS Code] Request completed: action=${request.url}, path=${result.path || result.projectPath}, exists=${result.exists}`);
			response.end(JSON.stringify({ ok: true, ...result }));
		} catch (error) {
			console.error(`Browser Link: ${error.message}`);
			response.writeHead(400);
			response.end(JSON.stringify({ error: error.message }));
		}
	});

	server.on("error", (error) => {
		console.error(`[Browser Link][VS Code] Server error: code=${error.code}, error=${error.stack || error.message}`);
		const message = error.code === "EADDRINUSE"
			? "Browser Link: Port 9998 is already in use. Close the other bridge before using this VS Code window."
			: `Browser Link: ${error.message}`;
		vscode.window.showErrorMessage(message);
	});
	server.listen(9998, "127.0.0.1", () => {
		console.log(`[Browser Link][VS Code] Listening on http://127.0.0.1:9998`);
	});
	context.subscriptions.push({ dispose: () => { server.close(); server.closeAllConnections(); } });
}

async function updateDevToolsWorkspace(folder) {
	if (folder.uri.scheme !== "file" || !vscode.workspace.isTrusted) return;
	try {
		const root = await fs.realpath(folder.uri.fsPath);
		const directory = path.join(root, ".well-known", "appspecific");
		const file = path.join(directory, "com.chrome.devtools.json");
		let metadata = {};
		try {
			metadata = JSON.parse(await fs.readFile(file, "utf8"));
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)
			|| (metadata.workspace !== undefined && (!metadata.workspace || typeof metadata.workspace !== "object" || Array.isArray(metadata.workspace)))) {
			throw new Error("Invalid DevTools workspace JSON. Existing file was left unchanged.");
		}
		metadata.workspace ??= {};
		if (metadata.workspace.root === root && metadata.workspace.uuid) return;
		metadata.workspace.root = root;
		metadata.workspace.uuid ||= randomUUID();
		await fs.mkdir(directory, { recursive: true });
		await fs.writeFile(file, JSON.stringify(metadata, null, 2) + "\n", "utf8");
		console.log(`[Browser Link][VS Code] DevTools workspace updated: file=${file}, root=${root}, uuid=${metadata.workspace.uuid}`);
	} catch (error) {
		console.error(`[Browser Link][VS Code] DevTools workspace update failed: project=${folder.uri.fsPath}, error=${error.stack || error.message}`);
	}
}

async function handleRequest(message) {
	if (!vscode.workspace.isTrusted) {
		throw new Error("Trust this VS Code workspace before using Browser Link.");
	}
	const folders = (vscode.workspace.workspaceFolders || []).filter((folder) => folder.uri.scheme === "file");
	const editorUri = vscode.window.activeTextEditor?.document.uri;
	console.log(`[Browser Link][VS Code] Resolving project: folders=${JSON.stringify(folders.map((item) => item.uri.fsPath))}, activeEditor=${editorUri?.toString()}`);
	const folder = folders.length === 1 ? folders[0] : editorUri && vscode.workspace.getWorkspaceFolder(editorUri);
	if (!folder || folder.uri.scheme !== "file") {
		throw new Error("Open a local project in VS Code. For a multi-folder workspace, select a file in the intended project.");
	}

	const url = new URL(message.url);
	if (!["http:", "https:"].includes(url.protocol)) {
		throw new Error("Only HTTP and HTTPS file URLs are supported.");
	}
	const segments = url.pathname.split("/").filter(Boolean).map((segment) => {
		const decoded = decodeURIComponent(segment);
		if (decoded === "." || decoded === ".." || /[\\/\0:]/.test(decoded)) {
			throw new Error("The URL contains an invalid file path.");
		}
		return decoded;
	});
	const root = await fs.realpath(folder.uri.fsPath);
	const target = path.join(root, ...segments);
	let filePath;
	console.log(`[Browser Link][VS Code] File mapping: url=${message.url}, root=${root}, target=${target}`);
	try {
		if ((await fs.stat(target)).isFile()) {
			const resolved = await fs.realpath(target);
			const relative = path.relative(root, resolved);
			if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
				throw new Error("The requested file is outside the current project.");
			}
			filePath = resolved;
		}
	} catch (error) {
		if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
	}
	console.log(`[Browser Link][VS Code] File status: path=${target}, exists=${Boolean(filePath)}, projectPath=${root}`);
	return { projectPath: root, exists: Boolean(filePath) };
}

module.exports = { activate };
