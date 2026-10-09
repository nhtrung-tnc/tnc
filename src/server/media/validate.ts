import { AppError } from "../http/errors";

const IMAGE_LIMIT = 20 * 1024 * 1024;
const PDF_LIMIT = 25 * 1024 * 1024;
const DIMENSION_LIMIT = 12_000;

export interface ValidatedMediaFile {
  bytes: Uint8Array<ArrayBuffer>;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/avif" | "application/pdf";
  extension: "jpg" | "png" | "webp" | "avif" | "pdf";
  byteSize: number;
  width: number | null;
  height: number | null;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function starts(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function containsAscii(bytes: Uint8Array, value: string, start = 0): boolean {
  const needle = [...value].map((character) => character.charCodeAt(0));
  outer: for (let offset = start; offset <= bytes.length - needle.length; offset++) {
    for (let index = 0; index < needle.length; index++) {
      if (bytes[offset + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}

function detect(bytes: Uint8Array): ValidatedMediaFile["mimeType"] | null {
  if (starts(bytes, [0xff, 0xd8])) return "image/jpeg";
  if (starts(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (ascii(bytes, 4, 4) === "ftyp" && ["avif", "avis"].includes(ascii(bytes, 8, 4))) return "image/avif";
  if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

function pngSize(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 45 || ascii(bytes, 12, 4) !== "IHDR" || !containsAscii(bytes, "IEND", 33)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

function jpegSize(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 12 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length - 2) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    if (marker === 0xd9) break;
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7) return null;
      return [
        (bytes[offset + 7]! << 8) | bytes[offset + 8]!,
        (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
      ];
    }
    offset += 2 + length;
  }
  return null;
}

function read24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function webpSize(bytes: Uint8Array): [number, number] | null {
  if (bytes.length < 30) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 > bytes.length) return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X") return [read24le(bytes, 24) + 1, read24le(bytes, 27) + 1];
  if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return [view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff];
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = view.getUint32(21, true);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }
  return null;
}

function avifSize(bytes: Uint8Array): [number, number] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset + 20 <= bytes.length; offset++) {
    if (ascii(bytes, offset + 4, 4) === "ispe") {
      const size = view.getUint32(offset);
      if (size < 20 || offset + size > bytes.length) return null;
      return [view.getUint32(offset + 12), view.getUint32(offset + 16)];
    }
  }
  return null;
}

function pdfComplete(bytes: Uint8Array): boolean {
  const start = Math.max(0, bytes.length - 1_024);
  return ascii(bytes, start, bytes.length - start).includes("%%EOF");
}

export async function validateMediaFile(file: File): Promise<ValidatedMediaFile> {
  if (file.size <= 0 || file.size > PDF_LIMIT) {
    throw new AppError("FILE_TOO_LARGE", 413, "File exceeds the upload limit");
  }
  const head = new Uint8Array(await file.slice(0, Math.min(file.size, 4_096)).arrayBuffer());
  const mimeType = detect(head);
  if (!mimeType || file.type !== mimeType) {
    throw new AppError("UNSUPPORTED_MEDIA", 415, "File content does not match an allowed format");
  }
  const isPdf = mimeType === "application/pdf";
  if (!isPdf && file.size > IMAGE_LIMIT) {
    throw new AppError("FILE_TOO_LARGE", 413, "Image exceeds the 20 MiB limit");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isPdf) {
    if (!pdfComplete(bytes)) throw new AppError("UNSUPPORTED_MEDIA", 415, "PDF is truncated");
    return { bytes, mimeType, extension: "pdf", byteSize: file.size, width: null, height: null };
  }
  const dimensions =
    mimeType === "image/png"
      ? pngSize(bytes)
      : mimeType === "image/jpeg"
        ? jpegSize(bytes)
        : mimeType === "image/webp"
          ? webpSize(bytes)
          : avifSize(bytes);
  if (!dimensions) throw new AppError("UNSUPPORTED_MEDIA", 415, "Image is truncated or invalid");
  const [width, height] = dimensions;
  if (width < 1 || height < 1 || width > DIMENSION_LIMIT || height > DIMENSION_LIMIT) {
    throw new AppError("INVALID_DIMENSIONS", 422, "Image dimensions exceed 12,000 pixels");
  }
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.slice("image/".length) as "png" | "webp" | "avif";
  return { bytes, mimeType, extension, byteSize: file.size, width, height };
}
