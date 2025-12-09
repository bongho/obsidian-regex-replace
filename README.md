# Obsidian Regex Replace

A powerful find and replace plugin for [Obsidian](https://obsidian.md) that supports **regular expressions** with **real-time preview** and **match highlighting**.

![Demo](https://img.shields.io/badge/Obsidian-Plugin-purple)
![License](https://img.shields.io/badge/License-MIT-green)

## Features

- **Regular Expression Support**: Full JavaScript regex syntax including capture groups (`$1`, `$2`, etc.)
- **Real-time Preview**: See matches highlighted before replacing
- **Match Highlighting**: Visual diff showing before/after changes
- **Regex Flags**: Toggle global (`g`), case-insensitive (`i`), and multiline (`m`) flags
- **Selection Mode**: Replace only within selected text
- **Pattern History**: Save and reuse recent search patterns
- **Dark/Light Theme**: Optimized for both Obsidian themes

## Installation

### From Obsidian Community Plugins (Recommended)

1. Open Obsidian Settings
2. Go to **Community Plugins** and disable **Restricted Mode**
3. Click **Browse** and search for "Regex Replace"
4. Click **Install**, then **Enable**

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/bongho/obsidian-regex-replace/releases)
2. Create a folder: `<YourVault>/.obsidian/plugins/regex-replace/`
3. Copy the downloaded files into this folder
4. Reload Obsidian and enable the plugin in Settings → Community Plugins

## Usage

### Opening the Replace Dialog

- **Hotkey**: `Cmd/Ctrl + Shift + H`
- **Command Palette**: `Cmd/Ctrl + P` → "Open Regex Replace"

### Interface

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

### Regex Examples

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

### Capture Groups

Use parentheses `()` to capture groups and reference them with `$1`, `$2`, etc.:

```
Search:  (\w+)@(\w+)\.com
Replace: User: $1, Domain: $2

Input:   test@example.com
Output:  User: test, Domain: example
```

## Settings

Access via Settings → Regex Replace:

| Setting | Description | Default |
|---------|-------------|---------|
| Default Flags | Pre-selected regex flags | `g` |
| Show Preview | Display before/after preview | `true` |
| History Limit | Max saved patterns | `10` |

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
node test.js
```

## Changelog

### 1.0.0
- Initial release
- Regex find and replace with preview
- Real-time match highlighting
- Pattern history
- Selection-only mode

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

If you find this plugin useful, consider:
- Starring the repository on GitHub
- Reporting issues or suggesting features
- Contributing code improvements

---

Made with ❤️ for the Obsidian community
