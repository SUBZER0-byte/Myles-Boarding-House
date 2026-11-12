import { describe, expect, it } from "vitest";
import { findQrSquare } from "@/lib/cropGcashQr";

describe("findQrSquare", () => {
  it("finds a square QR region on a colored GCash-style background", () => {
    const width = 320;
    const height = 600;
    const pixels = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = (y * width + x) * 4;
        pixels[pixel] = 0;
        pixels[pixel + 1] = 90;
        pixels[pixel + 2] = 220;
        pixels[pixel + 3] = 255;
      }
    }

    const qrLeft = 100;
    const qrTop = 220;
    const qrSize = 120;
    const moduleSize = 4;
    for (let moduleY = 0; moduleY < qrSize / moduleSize; moduleY += 1) {
      for (let moduleX = 0; moduleX < qrSize / moduleSize; moduleX += 1) {
        const isDark = ((moduleX * 17 + moduleY * 31 + moduleX * moduleY) % 7) < 4;
        if (!isDark) continue;
        for (let dy = 0; dy < moduleSize; dy += 1) {
          for (let dx = 0; dx < moduleSize; dx += 1) {
            const pixel = ((qrTop + moduleY * moduleSize + dy) * width
              + qrLeft + moduleX * moduleSize + dx) * 4;
            pixels[pixel] = 0;
            pixels[pixel + 1] = 0;
            pixels[pixel + 2] = 0;
          }
        }
      }
    }

    const bounds = findQrSquare(pixels, width, height);

    expect(bounds).not.toBeNull();
    expect(bounds!.x + bounds!.size / 2).toBeCloseTo(qrLeft + qrSize / 2, -1);
    expect(bounds!.y + bounds!.size / 2).toBeCloseTo(qrTop + qrSize / 2, -1);
    expect(bounds!.size).toBeGreaterThanOrEqual(qrSize * 0.8);
    expect(bounds!.size).toBeLessThanOrEqual(qrSize * 1.2);
  });
});
