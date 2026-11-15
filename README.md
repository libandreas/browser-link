# Link

Use the **Link extension for Chrome** together with Link in **Visual Studio Code**. Look for the blue paperclip icon.

[Download for Chrome](#)

## What Link does

Open the file behind the web page you are viewing with one click. Link adds an **Open in VS Code** button to your pages, so you can jump straight into editing your website.

Connect your website's CSS to your source code. Adjust colors, spacing, and layout in the browser, see the results immediately, and save supported CSS changes directly to your project files.

Use it while building a website on your computer or browsing its live version, as long as you have the matching project open locally.

## How to use it

1. Install Link in Visual Studio Code and open your website project.
2. Install the Link extension in Chrome.
3. Visit your website and click **Open in VS Code** at the bottom-right corner of the page.

Chrome may show **“Open Visual Studio Code?”** with the message **“[website address] wants to open this application.”** Click **Open Visual Studio Code** to continue. This opens the page's file through the `vscode://` link. The application name and wording may vary with your installation and browser language.

Keep your project open in VS Code while using Link. Your website's page paths need to match the files in that project.

If your VS Code workspace contains several project folders, select a file from the project you want to use before clicking the button.

## Connect CSS to your source code

Edit your website's appearance in the browser and save supported CSS changes to the files you work on in VS Code. Your saved styles stay in your source code, ready for the next time you open the website.

To connect your files, open your locally served website in Chrome, then select your project in **DevTools → Sources → Workspaces**. Allow access when prompted.

Link prepares this connection automatically when you open a trusted project in VS Code. It creates the configuration file that Chrome DevTools needs, so you can connect your project without setting it up by hand.

## Supported websites

Link currently works with HTML websites and PHP websites without a framework.

Support for more frameworks is planned.

## If something does not work

- **The button is missing:** make sure the Chrome extension is enabled and allowed on the website, then refresh the page.
- **VS Code does not open:** make sure Link is installed and enabled in VS Code, with your local project open.
- **The expected file does not open:** check that you opened the correct project and that the page's path matches a file inside it.
- **VS Code asks you to trust the project:** review the prompt and trust the folder if it is a project you trust.
