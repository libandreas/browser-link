const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { sign } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { setTimeout: delay } = require('node:timers/promises');

let accessToken;
let tokenExpiresAt = 0;

async function storeRequest(url, options = {}) {
	if (Date.now() >= tokenExpiresAt) {
		const issuedAt = Math.floor(Date.now() / 1000);
		const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
		const claims = Buffer.from(JSON.stringify({
			iss: process.env.CHROME_SERVICE_ACCOUNT_EMAIL,
			scope: 'https://www.googleapis.com/auth/chromewebstore',
			aud: 'https://oauth2.googleapis.com/token',
			iat: issuedAt,
			exp: issuedAt + 3600
		})).toString('base64url');
		const unsignedToken = `${header}.${claims}`;
		const signature = sign('RSA-SHA256', Buffer.from(unsignedToken), process.env.CHROME_PRIVATE_KEY).toString('base64url');
		const response = await fetch('https://oauth2.googleapis.com/token', {
			method: 'POST',
			body: new URLSearchParams({
				grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
				assertion: `${unsignedToken}.${signature}`
			})
		});
		const result = await response.json();
		if (!response.ok || !result.access_token || !result.expires_in) {
			throw new Error(`Chrome authentication failed | HTTP=${response.status} | error=${result.error || 'missing token or expiry'}`);
		}
		accessToken = result.access_token;
		tokenExpiresAt = Date.now() + (result.expires_in - 60) * 1000;
	}
	const response = await fetch(url, {
		...options,
		headers: { ...options.headers, Authorization: `Bearer ${accessToken}` }
	});
	const body = await response.text();
	if (!response.ok) {
		const error = new Error(`Chrome Web Store request failed | HTTP=${response.status} | response=${body}`);
		error.statusCode = response.status;
		throw error;
	}
	return JSON.parse(body);
}

async function readJson(filePath) {
	return JSON.parse((await fs.readFile(filePath, 'utf8')).replace(/^\uFEFF/, ''));
}

// Keep the .chromeignore matching rules used by the existing Build.mjs.
function globBodyToRegex(pattern) {
	let source = '';
	for (let index = 0; index < pattern.length; index++) {
		const char = pattern[index];
		if (char === '*' && pattern[index + 1] === '*') {
			source += '.*';
			index++;
		} else if (char === '*') {
			source += '[^/]*';
		} else if (char === '?') {
			source += '[^/]';
		} else {
			source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
		}
	}
	return source;
}

function globToRegex(pattern) {
	let sourcePattern = pattern.replace(/^\//, '');
	const startsAnywhere = sourcePattern.startsWith('**/');
	if (startsAnywhere) sourcePattern = sourcePattern.slice(3);
	if (sourcePattern.endsWith('/**/*')) sourcePattern = `${sourcePattern.slice(0, -5)}/**`;
	const prefix = startsAnywhere ? '(?:.*/)?' : '';
	if (sourcePattern.endsWith('/**')) {
		return new RegExp(`^${prefix}${globBodyToRegex(sourcePattern.slice(0, -3))}(?:/.*)?$`);
	}
	return new RegExp(`^${prefix}${globBodyToRegex(sourcePattern)}$`);
}

function isIgnored(relativePath, rules) {
	if (
		/\.php$/i.test(relativePath)
		|| /(?:^|\/)[^/]*backup[^/]*(?:\/|$)/i.test(relativePath)
		|| /(?:\.bak|\.backup|\.old|\.orig|\.swp|\.swo|\.tmp|~)$/i.test(relativePath)
	) return true;

	let ignored = false;
	for (const rule of rules) {
		if (rule.regex.test(relativePath)) ignored = !rule.negated;
	}
	return ignored;
}

async function collectChromeFiles(projectRoot, rules, suffix) {
	const files = [];
	async function walk(currentDir) {
		const entries = await fs.readdir(currentDir, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			const fullPath = path.join(currentDir, entry.name);
			const relativePath = path.relative(projectRoot, fullPath).replace(/\\/g, '/');
			if (entry.isDirectory()) {
				const hasIncludeRuleInside = rules.some(rule => rule.negated && rule.pattern.startsWith(`${relativePath}/`));
				if (entry.name.toLowerCase() === 'test-files' || (isIgnored(relativePath, rules) && !hasIncludeRuleInside)) {
					console.log(`Skip: ${relativePath}/**`);
					continue;
				}
				await walk(fullPath);
				continue;
			}
			if (!entry.isFile()) continue;
			if (isIgnored(relativePath, rules)) {
				console.log(`Skip: ${relativePath}`);
				continue;
			}
			console.log(`Add: ${relativePath}`);
			if (relativePath === `www/index${suffix}.html`) {
				const html = await fs.readFile(fullPath, 'utf8');
				const packagedHtml = html.replace(
					/^[\t ]*<!-- Not in Chrome Build Start -->[\s\S]*?^[\t ]*<!-- Not in Chrome Build End -->\r?\n?/gim, ''
				);
				files.push({ content: Buffer.from(packagedHtml, 'utf8'), relativePath });
				continue;
			}
			if (/^www\/worker\.xnv\.[3-7]\.min\.js$/.test(relativePath) || /^www\/transformers\.(?:xnv\.3|v3)\.min\.js$/.test(relativePath)) {
				let source = await fs.readFile(fullPath, 'utf8');
				if (/^www\/transformers\.(?:xnv\.3|v3)\.min\.js$/.test(relativePath)) {
					source = source.replace('allowRemoteModels:!0', 'allowRemoteModels:!1')
						.replace('remoteHost:"https://huggingface.co/"', 'remoteHost:"/"');
				}
				source = source.replace(/(["'`])https:\/\/(?:huggingface\.co|cdn\.jsdelivr\.net)(?:\/[^"'`\r\n]*)?\1/g, 'null');
				files.push({ content: Buffer.from(source, 'utf8'), relativePath });
				continue;
			}
			if (relativePath === 'www/embedding-worker.js') {
				const source = await fs.readFile(fullPath, 'utf8');
				const packagedSource = source.replace(/(["'`])https:\/\/zenodo\.org\/[^"'`\r\n]*\1/g, 'null');
				files.push({ content: Buffer.from(packagedSource, 'utf8'), relativePath });
				continue;
			}
			files.push({ fullPath, relativePath });
		}
	}
	await walk(projectRoot);
	return files;
}

async function main() {
	if (process.argv.length > 2) throw new Error('Place this script in the target project root or its common folder and run it without arguments.');
	const projectRoot = path.basename(__dirname).toLowerCase() === 'common' ? path.dirname(__dirname) : __dirname;
	process.loadEnvFile(path.join(projectRoot, '.env'));
	// After the first manual Store upload, copy its item ID into the root .env.
	// Leave CHROME_EXTENSION_ID empty to build without uploading.
	const missingKeys = ['CHROME_EXTENSION_ID', 'CHROME_SERVICE_ACCOUNT_EMAIL', 'CHROME_PRIVATE_KEY', 'CHROME_PUBLISHER_ID']
		.filter(name => !process.env[name]?.trim());
	const folderName = path.basename(projectRoot);
	const entries = await fs.readdir(projectRoot);
	const manifestPath = path.join(projectRoot, 'manifest.json');
	const manifest = await readJson(manifestPath);
	if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error(`Invalid version in ${manifestPath}.`);
	const workerPath = manifest.background?.service_worker;
	if (!workerPath) throw new Error(`Missing background.service_worker in ${manifestPath}.`);
	await fs.access(path.join(projectRoot, workerPath));
	const suffixMatch = /-(\d+)\.js$/i.exec(workerPath);
	const suffix = suffixMatch ? `-${suffixMatch[1]}` : '';
	const rawRules = await fs.readFile(path.join(projectRoot, '.chromeignore'), 'utf8');
	const rules = rawRules.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => {
		const negated = line.startsWith('!');
		const pattern = (negated ? line.slice(1) : line).replace(/\\/g, '/');
		return { negated, pattern, regex: globToRegex(pattern) };
	});
	const requireFromProject = createRequire(path.join(projectRoot, 'package.json'));
	const yazl = requireFromProject('yazl');
	const dateParts = new Intl.DateTimeFormat('en-GB', {
		timeZone: 'Europe/Athens', year: 'numeric', month: 'numeric'
	}).formatToParts(new Date());
	const year = Number(dateParts.find(part => part.type === 'year').value) % 100;
	const month = Number(dateParts.find(part => part.type === 'month').value);
	const [previousYear, previousMonth, previousPatch] = manifest.version.split('.').map(Number);
	const version = `${year}.${month}.${previousYear === year && previousMonth === month ? previousPatch + 1 : 0}`;
	manifest.version = version;
	await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`, 'utf8');
	for (const fileName of entries.filter(name => /^manifest(?:-\d+)?\.webmanifest$/i.test(name))) {
		const filePath = path.join(projectRoot, fileName);
		const webManifest = await readJson(filePath);
		webManifest.version = version;
		await fs.writeFile(filePath, `${JSON.stringify(webManifest, null, '\t')}\n`, 'utf8');
	}
	const outputPath = path.join(projectRoot, 'output.zip');
	console.log(`Build | project=${folderName} | version=${version} | output=${outputPath}`);
	const files = await collectChromeFiles(projectRoot, rules, suffix);
	const zip = new yazl.ZipFile();
	for (const file of files) {
		if (file.content) zip.addBuffer(file.content, file.relativePath);
		else zip.addFile(file.fullPath, file.relativePath);
	}
	zip.on('error', error => zip.outputStream.destroy(error));
	const zipWritten = pipeline(zip.outputStream, fsSync.createWriteStream(outputPath));
	zip.end();
	await zipWritten;
	console.log(`Package saved | output=${outputPath}`);
	if (missingKeys.length) {
		console.log(`Publish skipped | missing=${missingKeys.join(', ')} | package=${outputPath}`);
		return;
	}
	try {
		const itemId = process.env.CHROME_EXTENSION_ID.trim();
		if (!/^[a-p]{32}$/.test(itemId)) throw new Error('Invalid CHROME_EXTENSION_ID in the root .env. Expected the 32-letter Chrome Web Store item ID.');
		const itemPath = `publishers/${encodeURIComponent(process.env.CHROME_PUBLISHER_ID)}/items/${itemId}`;
		console.log(`Έλεγχος καταχώρισης | extension=${itemId}`);
		try {
			await storeRequest(`https://chromewebstore.googleapis.com/v2/${itemPath}:fetchStatus`);
		} catch (error) {
			if (error.statusCode === 404) {
				console.log(`Δεν έγινε upload | Δεν βρέθηκε προσβάσιμη αρχική καταχώριση στο Chrome Web Store. | extension=${itemId} | package=${outputPath}`);
				return;
			}
			throw error;
		}
		console.log(`Upload | project=${folderName} | version=${version}`);
		let upload = await storeRequest(`https://chromewebstore.googleapis.com/upload/v2/${itemPath}:upload`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/zip' },
			body: await fsSync.openAsBlob(outputPath, { type: 'application/zip' })
		});
		let uploadState = upload.uploadState;
		const deadline = Date.now() + 10 * 60 * 1000;
		while (uploadState === 'IN_PROGRESS') {
			if (Date.now() >= deadline) throw new Error(`Upload processing timed out | project=${folderName} | check the Chrome Web Store dashboard`);
			console.log(`Processing upload | project=${folderName} | state=${uploadState}`);
			await delay(5000);
			upload = await storeRequest(`https://chromewebstore.googleapis.com/v2/${itemPath}:fetchStatus`);
			uploadState = upload.lastAsyncUploadState;
		}
		if (uploadState !== 'SUCCEEDED') throw new Error(`Chrome upload failed | response=${JSON.stringify(upload)}`);
		const published = await storeRequest(`https://chromewebstore.googleapis.com/v2/${itemPath}:publish`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH' })
		});
		console.log(`Submitted | project=${folderName} | version=${version} | package=${outputPath} | response=${JSON.stringify(published)}`);
	} catch (error) {
		console.error(`Publish failed | package=${outputPath} | reason=${error.message}`);
		process.exitCode = 1;
	}
}

main().catch(error => {
	console.error(`Build and publish stopped | reason=${error.message}`);
	process.exitCode = 1;
});
