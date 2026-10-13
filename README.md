# alxwrd-mods

A Claude Code marketplace of small mods. Each mod lives in `mods/<name>/` and is
listed in `.claude-plugin/marketplace.json`.

## Install

```
/plugin install speak-aloud --marketplace alxwrd/alxwrd-mods
```

or from a local checkout:

```
/plugin install speak-aloud --marketplace /path/to/alxwrd-mods
```

## Mods

### speak-aloud

Reads the first paragraph of each reply aloud with [Piper](https://github.com/OHF-Voice/piper1-gpl) TTS.
Needs `uvx`, `curl` and `pkill`; audio playback is macOS only.

| Command | What it does |
| --- | --- |
| `/speak on\|off` | toggle speaking |
| `/speak install [voice]` | download a Piper voice (default `en_GB-alba-medium`) |
| `/speak speed <0.5-2>` | set playback speed and play a test sentence |
| `/speak reload` | restart the Piper HTTP server |

The footer shows `• speak` (green on, red off, with the speed when not 1x).
The `voice` option is a picker of Piper voices; the chosen voice downloads on first
use. Any other Piper voice works with `/speak install <name>`. The server uses port
5123 unless you change the `port` option. Set `dataDir` to keep voices outside the
plugin folder.

## Adding a mod

Create `mods/<name>/` with `.claude-plugin/plugin.json` and `hooks/`, then add an
entry with `"source": "./mods/<name>"` to `.claude-plugin/marketplace.json`.
