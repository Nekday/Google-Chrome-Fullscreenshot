# Full Page Screenshot — Chrome Extension

A minimal, self-contained Chrome extension (Manifest V3) that captures a
full-page screenshot of the active tab with a single keyboard shortcut and
saves it as a PNG to your Downloads folder.

No third-party dependencies. No CDN. No cloud uploads. No data collection.

---

## How It Works

The extension uses the **Chrome DevTools Protocol (CDP)** — the same engine
behind DevTools' built-in screenshot commands — to capture the page directly
from Chrome's renderer, then assembles the result entirely inside the
extension's service worker.

Because Chrome's screenshot rasterizer cannot reliably produce a single image
taller than roughly **16,384 pixels** (it tiles a repeated viewport instead),
the extension captures tall pages in **viewport-sized slices** and stitches
them into one continuous image:

1. Measure the full document dimensions (`Page.getLayoutMetrics`).
2. Neutralize `position: fixed` / `position: sticky` elements so site headers
   render once in normal flow instead of pinning to every slice.
3. Capture each slice by its absolute document offset using
   `captureBeyondViewport` (the page is never scrolled).
4. Draw each slice onto an `OffscreenCanvas` at its true position.
5. Export the stitched canvas to a PNG and save it.

This produces a pixel-accurate capture of the real rendered page — visible and
non-visible portions alike.

---

## Installation (Unpacked — No Chrome Web Store Required)

1. Clone or download this repository to a local folder.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle, top-right corner).
4. Click **Load unpacked** and select the `full-page-screenshot` folder.
5. The extension installs immediately.

---

## Usage

Press **Option + S** (Mac) / **Alt + S** (Windows/Linux) on any web page.

Chrome will briefly display a *"DevTools is debugging this tab"* notification
bar while the capture runs, and the screen may flicker as each slice is
rendered. Both clear automatically when the capture completes.

The PNG is saved to your **Downloads** folder using a filename modeled on
Microsoft Edge's format:

```
Screenshot_30-5-2026_151627_en.wikipedia.org.png
```

The date is `D-M-YYYY` (not zero-padded); the time is `HHMMSS` (zero-padded);
the hostname is taken from the captured page.

---

## Remapping the Keyboard Shortcut

Navigate to `chrome://extensions/shortcuts` and assign any combination you
prefer. Note that Chrome reserves certain shortcuts (e.g. `Cmd+Z`, `Cmd+C`)
and will not let an extension bind them.

---

## Performance Note

Capture time scales with page height, since each viewport-sized slice is a
separate capture-and-stitch cycle. A very long page (e.g. ~16,000 px) takes
roughly 25–30 seconds. Short and medium pages capture in one or a few slices
and complete quickly.

---

## Known Limitations

| Scenario | Behavior |
|---|---|
| `chrome://` or `chrome-extension://` pages | Capture blocked by Chrome; error logged to the service worker console |
| Chrome DevTools already open on the tab | Attach fails (only one debugger at a time); close DevTools first |
| Pages with lazy-loaded / infinite-scroll content | Only already-rendered content is captured |
| Unusual sticky layouts | The fixed/sticky neutralization is surgical, but very unconventional layouts may shift slightly during capture; the page is restored afterward |

---

## File Structure

```
full-page-screenshot/
├── manifest.json   # Extension metadata, permissions, and keyboard command
├── background.js   # Service worker: CDP capture, slice/stitch, save
└── README.md       # This file
```

---

## Permissions Explained

| Permission | Why It Is Needed |
|---|---|
| `debugger` | Attach CDP to the tab to issue `Page.captureScreenshot` |
| `downloads` | Save the PNG file to the Downloads folder |
| `tabs` | Identify the active tab and read its hostname for the filename |

---

## License

MIT — use freely, modify as needed.
