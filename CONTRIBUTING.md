# Contributing

Thanks for helping. This is a small project, so a short, focused change is the easiest to review.

## Before you start

- For a bug, open an issue with what you did, what you expected and what happened, plus the extension version and whether you use a browser or the desktop app.
- For a larger change or a new feature, open an issue first so we can agree on the approach.
- For a security problem, follow [SECURITY.md](SECURITY.md) instead.

## Development

There is nothing to install or build. Load `discord-markdown-renderer-extension/` from `chrome://extensions/` with Developer mode on, then reload the extension and Discord after each change.

The project's test suite is maintained separately and is not part of this repository. In your pull request, describe how you checked the change: what you ran, in which browser, and what you saw. Don't include private messages or server names in screenshots.

## Guidelines

- Match the style of the code around your change.
- The rendering logic lives in both `discord-markdown-renderer-extension/content_script.js` and `inject_console.js`. Change both together, and copy any change to `style.css` into the styles inside `inject_console.js`.
- Text shown to people comes in English and Traditional Chinese (`_locales/en`, `_locales/zh_TW`).
- Keep the extension free of network requests, stored data and extra permissions. If a change needs one, explain why in the pull request.
- Don't commit real keys, tokens or logs.

By contributing, you agree that your contribution is released under the [MIT License](LICENSE).
