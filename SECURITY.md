# Security

## How the extension works

The extension runs only on Discord's web pages. It reads the messages shown on the page and changes how they look in your browser. It asks for no extra permissions, makes no network requests and stores nothing. Rendered text is escaped before it is placed on the page.

`inject_console.js` has the same logic for pasting into the DevTools Console. Only paste a script you have read and got from a source you trust: anything pasted there runs with access to your Discord session.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's **Report a vulnerability** button (private vulnerability reporting) on this repository, with steps to reproduce and the version you saw it in.

We will acknowledge the report, work on a fix, and credit you in the release notes unless you prefer otherwise.
