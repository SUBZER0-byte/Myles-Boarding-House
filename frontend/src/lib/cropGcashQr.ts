export interface CropBounds {
  x: number;
  y: number;
  size: number;
}

export function findQrSquare(data: Uint8ClampedArray, width: number, height: number): CropBounds | null {
  const stride = width + 1;
  const integral = new Uint32Array(stride * (height + 1));

  for (let y = 0; y < height; y += 1) {
    let rowDarkPixels = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = (y * width + x) * 4;
      if (data[pixel] < 90 && data[pixel + 1] < 90 && data[pixel + 2] < 90) {
        rowDarkPixels += 1;
      }
      integral[(y + 1) * stride + x + 1] =
        integral[y * stride + x + 1] + rowDarkPixels;
    }
  }

  const minSize = Math.min(width, height);
  let best: CropBounds | null = null;
  let bestScore = 0;
  for (let size = 32; size <= minSize * 0.95; size += 2) {
    const step = Math.max(1, Math.floor(size / 16));
    const maxX = width - size;
    const maxY = height - size;
    for (let y = 0; y <= maxY; y += step) {
      for (let x = 0; x <= maxX; x += step) {
        const right = x + size;
        const bottom = y + size;
        const darkPixels = integral[bottom * stride + right]
          - integral[y * stride + right]
          - integral[bottom * stride + x]
          + integral[y * stride + x];
        const score = darkPixels / size;
        if (darkPixels >= 1000 && score > bestScore) {
          bestScore = score;
          best = { x, y, size };
        }
      }
    }
  }

  return bestScore >= 8 ? best : null;
}

export async function cropGcashQr(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Unable to prepare the GCash QR image for cropping.");

    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const bounds = findQrSquare(context.getImageData(0, 0, width, height).data, width, height);
    if (!bounds) {
      throw new Error("Could not detect a QR code in this image. Choose a clear image with the full QR code visible.");
    }

    const cropSize = Math.min(Math.min(width, height), Math.ceil(bounds.size * 1.12));
    const centerX = bounds.x + bounds.size / 2;
    const centerY = bounds.y + bounds.size / 2;
    const left = Math.max(0, Math.min(width - cropSize, Math.round(centerX - cropSize / 2)));
    const top = Math.max(0, Math.min(height - cropSize, Math.round(centerY - cropSize / 2)));

    const output = document.createElement("canvas");
    output.width = 400;
    output.height = 400;
    const outputContext = output.getContext("2d");
    if (!outputContext) throw new Error("Unable to create the cropped GCash QR image.");
    outputContext.fillStyle = "#fff";
    outputContext.fillRect(0, 0, output.width, output.height);
    outputContext.drawImage(bitmap, left / scale, top / scale, cropSize / scale, cropSize / scale, 0, 0, 400, 400);

    const outputType = ["image/jpeg", "image/png", "image/webp"].includes(file.type)
      ? file.type
      : "image/jpeg";
    const extension = outputType === "image/png" ? "png" : outputType === "image/webp" ? "webp" : "jpg";
    const blob = await new Promise<Blob>((resolve, reject) => {
      output.toBlob(
        result => result ? resolve(result) : reject(new Error("Unable to encode the cropped GCash QR image.")),
        outputType,
        outputType === "image/png" ? undefined : 0.95,
      );
    });
    return new File([blob], `gcash-qr-cropped.${extension}`, { type: outputType, lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}
