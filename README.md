# Figmode

Vi-style "modal" keyboard control for Figma autolayout. Set flow, sizing, alignment, gap, and padding in a few keystrokes instead of clicking through the properties panel.

Figmode (like `vi`) uses "modes" to interpret key inputs. This allows you to keep your left hand in one place, as nearly all of the (default) keys are located there.

For example, to rapidly set a frame's flow direction to row, width mode to hug, height mode to fixed 20px, spacing to 5, and padding-all to 10, you would type `r`, `w`, `s`, `` ` ``, `h`, `a`, `20`, `` ` ``, `s`, `5`, `` ` ``, `p`, `s`, `10`.

Believe it or not, once you get used to what all the keys do, you can do this extremely quickly and efficiently.

## How it works

1. Select one or more objects (or an existing autolayout frame).
2. Run **Plugins → Figmode → Layout Mode** (I recommend assigning a shortcut at your OS level; more information on this below).
3. A small HUD appears in the bottom-left showing the current mode and available keys.
4. Type key sequences to set parameters and change modes. Modes are a stack, so you go deeper with a key, and back out with `` ` ``.
5. Press **Esc** to quit at any time, or tap `` ` `` until it exits.

If the selection isn’t an autolayout yet, Figmode wraps it in a frame (or converts a group) and applies vertical auto layout.

Changes apply live as you type. In value entry, digits update the frame immediately; **Enter** confirms and backs out.

## Global keys

| Key       | Action                                    |
| --------- | ----------------------------------------- |
| `` ` ``   | Back one mode (at root, closes Figmode)   |
| `Esc`     | Quit                                      |
| `Shift+S` | Settings — remap keys (does not time out) |

## Layout mode

| Key | Action                    |
| --- | ------------------------- |
| `R` | Row flow                  |
| `C` | Column flow               |
| `F` | Freeform (no auto layout) |
| `G` | Grid flow                 |
| `E` | Toggle wrap               |
| `W` | Width                     |
| `H` | Height                    |
| `A` | Alignment                 |
| `S` | Spacing (gap)             |
| `P` | Padding                   |

### Width / Height

| Key | Action                    |
| --- | ------------------------- |
| `A` | Fixed — enter pixel value |
| `S` | Hug contents              |
| `D` | Fill container            |

### Alignment

Nine keys map to the alignment grid:

```
Q  W  E     top-left    top    top-right
A  S  D  =  left        center right
Z  X  C     bottom-left bottom bottom-right
```

### Spacing

| Key | Action                                                    |
| --- | --------------------------------------------------------- |
| `F` | Toggle auto gap ↔ fixed px gap (fixed enters value entry) |

Entering spacing with a fixed gap already set goes straight to gap value entry.

### Padding

| Key | Side       |
| --- | ---------- |
| `S` | All        |
| `W` | Top        |
| `A` | Left       |
| `D` | Right      |
| `X` | Bottom     |
| `Q` | Horizontal |
| `E` | Vertical   |

### Value entry

Used for gap, width, height, and padding.

| Key                   | Action              |
| --------------------- | ------------------- |
| `0`–`9`               | Type digits         |
| `↑` / `↓`             | ±1                  |
| `Shift+↑` / `Shift+↓` | ±10                 |
| `Backspace`           | Delete digit        |
| `Enter`               | Confirm and go back |

## Example

Row layout, fill width, 16px horizontal padding:

```
R          → row
W D        → width → fill
`          → back to layout
P Q 16 ↵   → padding → horizontal → 16 → confirm
```

## Development

```bash
pnpm install
pnpm run build    # or pnpm run watch
```

Import the plugin in Figma via **Plugins → Development → Import plugin from manifest…** and point at this folder. Re-run the plugin after changing main-thread code.
