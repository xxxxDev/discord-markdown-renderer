# Security

## What Discord Markdown Renderer can see and do

The extension runs only on Discord's web pages (`discord.com` and its subdomains). It reads the messages shown on the page and changes how they look in your browser. It asks for no extra permissions, makes no network requests and stores nothing. Rendered text is escaped before it is placed on the page.

`inject_console.js` has the same logic for pasting into the DevTools Console.

## Keep in mind

- It changes only how messages are drawn on your screen. It doesn't send, edit or delete messages, and other people still see the original text.
- What you see is a rendered version of the message, not the text that was sent. To check the original, turn the extension off and reload Discord.
- The extension runs in Chrome on Discord's web pages only, and does nothing on other sites. The console script can also be pasted into the DevTools Console of the Discord desktop app, which is an Electron app.
- Only paste a script into the DevTools Console if you have read it and got it from a source you trust: anything pasted there runs with access to your Discord session.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Email [support@v-ax.com](mailto:support@v-ax.com) instead. You can also use GitHub's **Report a vulnerability** button on this repository.

Include Discord Markdown Renderer, the version or commit, the relevant platform, minimal steps to reproduce, and the expected and observed results. Use fictional data where possible and redact sensitive information from errors or screenshots.

Do not send passwords, tokens, private keys, account data, or raw private logs. Include only the information needed to reproduce the problem.

For ordinary usage questions and non-sensitive bugs, use this repository's issue tracker.
