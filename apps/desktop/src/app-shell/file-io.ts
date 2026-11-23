import { Capacitor, registerPlugin } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

// File I/O for both shells. Electron's Chromium handles `<input type=file>`, downloads (with a
// save dialog) and `print()` itself. Android's WebView does file inputs, but ignores downloads
// and `print()`, so there exports go through the share sheet and printing through a native plugin
// (`android/app/src/main/java/com/renote/app/PrintPlugin.java`).

const isAndroid = Capacitor.getPlatform() === "android";
const NativePrint = registerPlugin<{ printHtml(options: { html: string; title: string }): Promise<void> }>(
  "Print",
);

/** Opens the platform file picker. Resolves to `null` if the user cancels. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

/** Saves `blob`: a save dialog on desktop, the share sheet (Files, Drive, …) on Android. */
export async function downloadBlob(blob: Blob, fileName: string): Promise<void> {
  if (isAndroid) {
    const { uri } = await Filesystem.writeFile({
      path: fileName,
      data: await blobToBase64(blob),
      directory: Directory.Cache,
    });
    await Share.share({ title: fileName, files: [uri] });
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Prints a standalone HTML document; the OS print dialog offers "Save as PDF". */
export async function printHtml(html: string): Promise<void> {
  const title = /<title>(.*?)<\/title>/.exec(html)?.[1] ?? "reNote";
  if (isAndroid) return NativePrint.printHtml({ html, title });
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;visibility:hidden";
  frame.srcdoc = html;
  frame.addEventListener(
    "load",
    () => {
      frame.contentWindow?.addEventListener("afterprint", () => frame.remove(), { once: true });
      frame.contentWindow?.print();
    },
    { once: true },
  );
  document.body.appendChild(frame);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // `readAsDataURL` gives "data:<mime>;base64,<data>" — Filesystem wants just the data.
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
