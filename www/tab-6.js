(() => {
	"use strict";
	if (window.top !== window) return;
	// console.log(`[Browser Link][Page] Loaded: ${location.href}`);

	const style = document.createElement("style");
	style.textContent = "#floating-tools-div > a > small > img {width:0.4em !important;height:0.4em !important}";
	const toolbarNodes = [];

	for (const [editor, title] of [
		["vscode", "VSCode"],
		// ["jetbrains", "JetBrains"],
	]) {
		const link = document.createElement("a");
		link.id = `browser-link-open-in-${editor}`;
		link.className = "cms-link";
		link.href = "#";
		link.style.cssText = "text-decoration:none;color:royalblue;text-shadow:1px 1px white";
		const label = document.createElement("small");
		label.style.fontSize = "12pt";
		label.textContent = `Open in ${title} 💻`;
		link.append(label);
		toolbarNodes.push(link, document.createElement("br"));
		let opening = false;

		link.addEventListener("click", async (event) => {
			event.preventDefault();
			// console.log(`[Browser Link][Page] Open clicked: editor=${editor}, url=${location.href}, opening=${opening}`);
			if (opening) return;
			opening = true;
			try {
				const fileUrl = new URL(location.href);
				if (fileUrl.pathname.endsWith("/")) {
					fileUrl.pathname += "index.php";
				} else if (!fileUrl.pathname.split("/").at(-1).includes(".")) {
					fileUrl.pathname += ".php";
				}
				const result = await chrome.runtime.sendMessage({ action: "open", editor, url: fileUrl.href });
				// console.log(`[Browser Link][Page] Open response: editor=${editor}, result=${JSON.stringify(result)}`);
				if (!result?.ok) {
					trigger_error(result?.error || `Unable to communicate with ${title}.`);
					return;
				}
				if (!result.projectPath || typeof result.exists !== "boolean") {
					throw new Error(`${title} did not return the project path and file status. Reload the IDE extension.`);
				}
				if (!result.exists && /\.php$/i.test(fileUrl.pathname)) {
					fileUrl.pathname = fileUrl.pathname.replace(/\.php$/i, ".html");
				}
				const projectPath = result.projectPath.replace(/\\/g, "/").replace(/\/$/, "");
				const relativePath = fileUrl.pathname.split("/").filter(Boolean).map(decodeURIComponent).join("/");
				const fullPath = `${projectPath}/${relativePath}`;
				let openUrl;
				if (editor === "jetbrains") {
					if (!/^[a-z-]+$/.test(result.product || "") || !result.projectName) {
						throw new Error("JetBrains did not return its product and project name.");
					}
					openUrl = `jetbrains://${result.product}/navigate/reference?project=${encodeURIComponent(result.projectName)}&path=${encodeURIComponent(fullPath)}`;
				} else {
					openUrl = `vscode://file/${fullPath.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")}`;
				}
				// console.log(`[Browser Link][Page] Opening protocol: editor=${editor}, exists=${result.exists}, url=${openUrl}`);
				window.location.assign(openUrl);
			} catch (error) {
				console.error(`[Browser Link][Page] Open failed: editor=${editor}, error=${error.stack || error.message || error}`);
				trigger_error(error.message || `Unable to communicate with ${title}.`);
			} finally {
				opening = false;
			}
		});
	}

	function attachLinks() {
		if (!document.body) return;
		if (!style.isConnected) (document.head || document.body).append(style);
		let toolbar = document.getElementById("floating-tools-div");
		if (!toolbar) {
			toolbar = document.createElement("div");
			toolbar.id = "floating-tools-div";
			toolbar.style.cssText = "background:transparent;display:inline-block;position:fixed;bottom:0;right:0;z-index:2147483550;text-align:right;padding:6px";
			document.body.append(toolbar);
		}
		for (const link of toolbarNodes.filter((node) => node.tagName === "A")) {
			const existing = document.getElementById(link.id);
			if (existing && existing !== link) {
				if (existing.nextSibling?.nodeName === "BR") existing.nextSibling.remove();
				existing.remove();
			}
		}
		if (toolbarNodes.some((node, index) => toolbar.childNodes[index] !== node)) {
			toolbar.prepend(...toolbarNodes);
			// console.log("[Browser Link][Page] Open buttons attached to floating toolbar");
		}
	}

	attachLinks();
	new MutationObserver(attachLinks).observe(document.documentElement, { childList: true, subtree: true });
})();
