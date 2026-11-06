# Contributing

Thanks for helping with QuestSound!

## Bugs and ideas

Open an [issue](https://github.com/artemfrikk/questsound/issues). For a bug, please include:

- the Obsidian version and platform (Windows, macOS, Linux, Android, iOS);
- the plugin version (Settings → Community plugins);
- what you did, what you expected and what happened instead;
- the `questsound` code block or note property involved, if any.

Issues in English or Russian are both welcome.

## Code

The plugin is plain JavaScript with no build step: `main.js`, `manifest.json` and `styles.css` in this repository are exactly what Obsidian loads. The panel itself is the QuestSound web app (https://questsound.ru) shown in a frame, so most features and fixes live there rather than in this repository.

Pull requests are welcome for the plugin side: commands, note buttons, note properties and settings. Keep it dependency-free and follow the style of the existing code. Releases are made by pushing a tag equal to the `version` in `manifest.json`; the release workflow attests and publishes the files.
