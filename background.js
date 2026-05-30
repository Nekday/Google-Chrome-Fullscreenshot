// background.js
// Full Page Screenshot Extension  (v10 — v6 absolute-clip engine + sticky fix)
//
// Captures a full-page screenshot of the active tab and saves it as a PNG.
//
// ── ENGINE: absolute-offset slices, NO scrolling (the v6 method) ──────────
// Chrome's screenshot rasterizer tiles content when asked to capture a region
// taller than the live viewport, so we capture in viewport-sized slices and
// stitch them with an OffscreenCanvas.  Crucially, slices are addressed by
// their ABSOLUTE document offset via captureBeyondViewport — the page is never
// scrolled.  (Scroll-then-clip-at-y:0 produced blank slices; absolute clips
// are the version that captured correctly.)
//
// ── STICKY / FIXED FIX ─────────────────────────────────────────────────────
// position:fixed and position:sticky elements (site headers) pin to the
// viewport and re-render in every slice, stamping into seams and overwriting
// content.  Before capturing we inject a stylesheet that neutralizes only
// fixed/sticky positioning (matched by computed style), then remove it after.

chrome.commands.onCommand.addListener(async (command) => {

  // Guard: only act on our named command
  if (command !== "capture-full-page") return;

  // Retrieve the currently active tab in the focused window
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    console.warn("Full Page Screenshot: no active tab found.");
    return;
  }

  const tabId  = tab.id;
  const target = { tabId };

  // Helper: send a CDP command and await the result
  const send = (method, params = {}) =>
    chrome.debugger.sendCommand(target, method, params);

  // Helper: small pause to let the page settle after a layout change
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Helper: zero-pad a number to two digits (e.g. 6 → "06")
  const pad = (n) => String(n).padStart(2, "0");

  // Marker id for our injected stylesheet, so we can remove exactly it later.
  const STYLE_ID = "__fps_sticky_override__";

  try {

    // ── Step 1: Attach CDP debugger to the active tab ─────────────────────
    // Chrome shows a "DevTools is debugging this tab" bar while attached;
    // it clears automatically on detach.
    await chrome.debugger.attach(target, "1.3");

    // ── Step 2: Neutralize fixed/sticky elements ──────────────────────────
    // Done BEFORE measuring, because neutralizing can change the document
    // height (a fixed header removed from the overlay returns to flow).
    // Surgical: only elements whose computed position is fixed/sticky are
    // set to static, via a stylesheet keyed to a generated marker attribute.
    await send("Runtime.evaluate", {
      expression: `
        (() => {
          const rules = [];
          let n = 0;
          document.querySelectorAll('*').forEach((el) => {
            const pos = getComputedStyle(el).position;
            if (pos === 'fixed' || pos === 'sticky') {
              el.setAttribute('data-fps-neutralized', String(n));
              rules.push('[data-fps-neutralized="' + n + '"]{position:static !important;}');
              n++;
            }
          });
          const s = document.createElement('style');
          s.id = '${STYLE_ID}';
          s.textContent = rules.join('\\n');
          document.head.appendChild(s);
        })();
      `
    });

    // Allow the page to reflow after neutralization before measuring.
    await wait(120);

    // ── Step 3: Measure the page (after neutralization) ───────────────────
    // cssLayoutViewport → the natural viewport (the slice size)
    // cssContentSize    → the full scrollable document dimensions
    const metrics = await send("Page.getLayoutMetrics");

    const { cssContentSize, cssLayoutViewport } = metrics;
    const viewportWidth  = Math.ceil(cssLayoutViewport.clientWidth);
    const viewportHeight = Math.ceil(cssLayoutViewport.clientHeight);
    const contentWidth   = Math.ceil(cssContentSize.width);
    const contentHeight  = Math.ceil(cssContentSize.height);

    console.log(`Full Page Screenshot: capturing ${contentWidth}x${contentHeight} ` +
                `in slices of ${viewportHeight}px`);

    // ── Step 4: Prepare the stitch canvas ─────────────────────────────────
    // One OffscreenCanvas the size of the full document.  Each captured slice
    // is decoded to an ImageBitmap and drawn at its absolute offset.
    const canvas = new OffscreenCanvas(contentWidth, contentHeight);
    const ctx    = canvas.getContext("2d");

    // ── Step 5: Capture slices by absolute document offset (v6 method) ────
    // No scrolling.  For each slice, clip directly at its document y-position
    // with captureBeyondViewport.  Each slice is only viewportHeight tall, so
    // it stays under the height ceiling that causes tiling.  The final slice
    // is clamped to the exact remaining pixels — no overlap or padding.
    for (let sliceY = 0; sliceY < contentHeight; sliceY += viewportHeight) {

      const sliceHeight = Math.min(viewportHeight, contentHeight - sliceY);

      const shot = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        clip: {
          x:      0,
          y:      sliceY,        // absolute document position
          width:  viewportWidth,
          height: sliceHeight,
          scale:  1
        }
      });

      // Decode the base64 PNG into an ImageBitmap the canvas can draw.
      const bytes  = Uint8Array.from(atob(shot.data), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));

      // Draw this slice at its true document position.
      ctx.drawImage(bitmap, 0, sliceY);
      bitmap.close();
    }

    // ── Step 6: Restore the page ──────────────────────────────────────────
    // Remove the sticky-override stylesheet and the marker attributes, then
    // detach so the DevTools bar clears.
    await send("Runtime.evaluate", {
      expression: `
        (() => {
          document.getElementById('${STYLE_ID}')?.remove();
          document.querySelectorAll('[data-fps-neutralized]')
            .forEach((el) => el.removeAttribute('data-fps-neutralized'));
        })();
      `
    });
    await chrome.debugger.detach(target);

    // ── Step 7: Export the stitched canvas to a PNG blob ──────────────────
    const blob = await canvas.convertToBlob({ type: "image/png" });

    // Convert the blob to a data URL (FileReader is supported in service workers).
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

    // ── Step 8: Build a filename in the Edge style ────────────────────────
    // Format:  Screenshot_D-M-YYYY_HHMMSS_hostname.png
    // Date parts NOT zero-padded (matching Edge); time parts ARE zero-padded.
    const now      = new Date();
    const datePart = `${now.getDate()}-${now.getMonth() + 1}-${now.getFullYear()}`;
    const timePart = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    let hostname = "page";
    try {
      hostname = new URL(tab.url).hostname || "page";
    } catch (_) { /* keep fallback */ }

    const filename = `Screenshot_${datePart}_${timePart}_${hostname}.png`;

    // ── Step 9: Save the PNG to the Downloads folder ──────────────────────
    await chrome.downloads.download({
      url:      dataUrl,
      filename: filename,
      saveAs:   false
    });

    console.log(`Full Page Screenshot saved: ${filename}`);

  } catch (error) {

    // ── Error handling ────────────────────────────────────────────────────
    // Attempt to undo the page modifications and detach before logging.
    try {
      await send("Runtime.evaluate", {
        expression: `
          (() => {
            document.getElementById('${STYLE_ID}')?.remove();
            document.querySelectorAll('[data-fps-neutralized]')
              .forEach((el) => el.removeAttribute('data-fps-neutralized'));
          })();
        `
      });
    } catch (_) { /* ignore */ }

    try {
      await chrome.debugger.detach(target);
    } catch (_) {
      // Never attached or already detached — ignore.
    }

    console.error("Full Page Screenshot failed:", error.message ?? error);
  }

});
