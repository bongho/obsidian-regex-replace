# Obsidian Regex Replace

Safely clean up Markdown in [Obsidian](https://obsidian.md) with **live previews**, **match highlighting**, and reusable **multi-step pipelines**.

[![Obsidian plugin](https://img.shields.io/badge/Install_in-Obsidian-7c3aed?logo=obsidian)](https://obsidian.md/plugins?id=regex-replace)
![License](https://img.shields.io/badge/License-0BSD-green)

Preview every change before it touches your note. Run a one-off replacement or
save a complete cleanup workflow for PDFs, AI-generated text, and Markdown.

## Why Regex Replace?

| Capability | Obsidian's built-in replace | Regex Replace |
|---|---:|---:|
| Regular expressions and capture groups | — | ✓ |
| Before/after preview | — | ✓ |
| Match highlighting | — | ✓ |
| Replace within a selection | — | ✓ |
| Reusable multi-step cleanup pipelines | — | ✓ |
| Import regex-pipeline rulesets | — | ✓ |

Everything runs locally in your vault. The plugin does not send note content to
external services.

## Features

- **Regular Expression Support**: Full JavaScript regex syntax including capture groups (`$1`, `$2`, etc.)
- **Real-time Preview**: See matches highlighted before replacing
- **Match Highlighting**: Visual diff showing before/after changes
- **Regex Flags**: Toggle global (`g`), case-insensitive (`i`), and multiline (`m`) flags
- **Selection Mode**: Replace only within selected text
- **Pattern History**: Save and reuse recent search patterns
- **Pipeline Rulesets**: Save reusable multi-step rulesets and apply them in sequence, with a step-by-step preview — and import existing [regex-pipeline](https://github.com/No3371/obsidian-regex-pipeline) rulesets
- **Dark/Light Theme**: Optimized for both Obsidian themes

## Popular cleanup recipes

Copy a search and replacement into **Regex Replace**, review the preview, and
apply it only when the result is correct for your note.

| Cleanup | Search | Replace | Flags |
|---|---|---|---|
| Collapse repeated spaces | ` {2,}` | ` ` | `g` |
| Remove trailing whitespace | `[ \t]+$` | *(empty)* | `gm` |
| Collapse 3+ blank lines | `\n{3,}` | `\n\n` | `g` |
| Change H2 headings to H3 | `^## ` | `### ` | `gm` |
| Convert ISO dates to day/month/year | `(\d{4})-(\d{2})-(\d{2})` | `$3/$2/$1` | `g` |
| Remove Markdown bold markers | `\*\*([^*]+)\*\*` | `$1` | `g` |
| Convert simple wiki links to Markdown links | `\[\[([^\]|]+)\]\]` | `[$1]($1.md)` | `g` |

> [!CAUTION]
> A regular expression can match more text than intended. Check the highlighted
> preview before applying a replacement, especially with broad patterns.

## Installation

Requires Obsidian **1.13.0 or later** — the settings tab uses the declarative
settings API introduced in that version, so its settings appear in Obsidian's
settings search. Version 1.1.5 remains available for older releases.

### From Obsidian Community Plugins (Recommended)

1. Open **Settings → Community plugins** in Obsidian.
2. Select **Browse** and search for **Regex Replace**.
3. Select **Install**, then **Enable**.

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/bongho/obsidian-regex-replace/releases)
2. Create a folder: `<YourVault>/.obsidian/plugins/regex-replace/`
3. Copy the downloaded files into this folder
4. Reload Obsidian and enable the plugin in Settings → Community Plugins

## Usage

### Open the replace dialog

- **Hotkey**: `Cmd/Ctrl + Shift + H`
- **Command Palette**: `Cmd/Ctrl + P` → "Open Regex Replace"

### Preview before replacing

```
┌─────────────────────────────────────────────┐
│ Search Pattern:  [Enter regex pattern]      │
│ Replace With:    [Replacement text]         │
│                                             │
│ Flags: ☑ g (global)  ☐ i  ☐ m              │
│ ☐ Replace in selection only                 │
│                                             │
│ 3 match(es) found                           │
│                                             │
│ Before: Hello [world], hello [world]        │  ← Yellow highlight
│ After:  Hello [WORLD], hello [WORLD]        │  ← Green highlight
│                                             │
│ Matches (3):                                │
│ • "world" → "WORLD"                         │
│                                             │
│                    [Replace All] [Cancel]   │
└─────────────────────────────────────────────┘
```

### Regex examples

| Use Case | Search Pattern | Replace | Result |
|----------|---------------|---------|--------|
| Find numbers | `\d+` | `[NUM]` | `abc123` → `abc[NUM]` |
| Date format | `(\d{4})-(\d{2})-(\d{2})` | `$3/$2/$1` | `2024-12-08` → `08/12/2024` |
| Remove extra spaces | `\s+` | ` ` | Multiple spaces → single |
| Wiki to MD link | `\[\[(.+?)\]\]` | `[$1]($1.md)` | `[[Note]]` → `[Note](Note.md)` |
| Header H2 → H3 | `^## ` | `### ` | `## Title` → `### Title` |
| Remove bold | `\*\*(.+?)\*\*` | `$1` | `**bold**` → `bold` |
| Extract link text | `\[(.+?)\]\((.+?)\)` | `$1: $2` | `[text](url)` → `text: url` |

### Flags

| Flag | Name | Description |
|------|------|-------------|
| `g` | Global | Replace all matches (not just the first) |
| `i` | Ignore Case | Case-insensitive matching |
| `m` | Multiline | `^` and `$` match line starts/ends |

### Capture groups

Use parentheses `()` to capture groups and reference them with `$1`, `$2`, etc.:

```
Search:  (\w+)@(\w+)\.com
Replace: User: $1, Domain: $2

Input:   test@example.com
Output:  User: test, Domain: example
```

## Pipeline Rulesets

A ruleset is a named list of find/replace rules applied **in sequence** — each rule
operates on the previous rule's output. Useful for repeatable, multi-step cleanups
(e.g. normalize headers, then collapse whitespace, then fix links).

### Defining a ruleset

In Settings → Regex Replace → **Pipeline rulesets**, click **Add ruleset**, name it,
and write rules using [regex-pipeline](https://github.com/No3371/obsidian-regex-pipeline)
syntax (one rule per block):

```
"SEARCH"->"REPLACE"
"\s+"->" "
"##\s"gm->"### "
```

- Inline flags follow the search quote (e.g. `"foo"gi->"bar"`); without them, `gm` is used.
- Replacements may span multiple lines.

### Applying a ruleset

- **Command Palette**: "Apply ruleset (pipeline)" → pick a ruleset → review the
  step-by-step preview (match count per rule) → **Apply pipeline**.
- A rule with an invalid regex is skipped and reported, never aborting the whole run.

### Importing from regex-pipeline

Click **Import from regex-pipeline** to read every ruleset file in
`<vault>/.obsidian/regex-rulesets/` and convert it into a native ruleset.

### Starter pipeline: clean pasted text

This ruleset removes trailing whitespace, reduces large blank gaps, and
normalizes repeated spaces. Add it under **Settings → Regex Replace → Pipeline
rulesets**, then preview it with **Apply ruleset (pipeline)**.

```text
"[ \\t]+$"gm->""
"\\n{3,}"g->"\\n\\n"
" {2,}"g->" "
```

## Settings

Access via Settings → Regex Replace:

| Setting | Description | Default |
|---------|-------------|---------|
| Default Flags | Pre-selected regex flags | `g` |
| Show Preview | Display before/after preview | `true` |
| History Limit | Max saved patterns | `10` |
| Pipeline rulesets | Add/edit/delete/import reusable rulesets | — |

## Development

```bash
# Clone the repository
git clone https://github.com/bongho/obsidian-regex-replace.git

# Install dependencies
npm install

# Build for development (watch mode)
npm run dev

# Build for production
npm run build

# Run tests
npx ts-node --transpile-only test.ts
```

## Changelog

### 1.1.5
- Add dynamic ruleset commands for direct Obsidian invocation (Ruleset: <name>)
- Enable integration with Commander, Editing Toolbar, and macro plugins
- Add maintainer info to README (Korean developer, AI researcher)

### 1.1.4
- Reposition the plugin around safe previews and reusable cleanup pipelines
- Add practical Markdown cleanup recipes and a built-in feature comparison
- Align package metadata and documentation with the 0BSD license

### 1.1.0
- Pipeline rulesets: save reusable multi-step rulesets, apply in sequence with step preview
- Import rulesets from the regex-pipeline plugin
- New command: "Apply ruleset (pipeline)"

### 1.0.0
- Initial release
- Regex find and replace with preview
- Real-time match highlighting
- Pattern history
- Selection-only mode

## License

0BSD License — see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

If you find this plugin useful, consider:
- Starring the repository on GitHub
- Reporting issues or suggesting features
- Contributing code improvements

## About

Maintained by [Bongho Lee](https://github.com/bongho), a Korean developer and AI researcher. 
Feedback, issues, and pull requests are welcome!

---

Made with ❤️ for the Obsidian community
