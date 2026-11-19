const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function deduplicateName(rawName: string, seen: Map<string, number>): string {
  const clean = rawName.replace(/[\\/]+/g, '_') || 'output.webp';
  const count = seen.get(clean) ?? 0;
  seen.set(clean, count + 1);
  if (count === 0) return clean;
  const dot = clean.lastIndexOf('.');
  if (dot <= 0) return `${clean}-${count + 1}`;
  return `${clean.slice(0, dot)}-${count + 1}${clean.slice(dot)}`;
}

/**
 * Zero-dependency standard PKZIP (STORE method 0 + IEEE 802.3 CRC-32) archive builder.
 * Ideal for already-compressed PNG/WebP/JPEG/GIF media blobs in the browser.
 */
export async function buildZipBlob(
  entries: Array<{ name: string; blob: Blob }>
): Promise<Blob> {
  const encoder = new TextEncoder();
  const seenNames = new Map<string, number>();

  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const fileName = deduplicateName(entry.name, seenNames);
    const nameBytes = encoder.encode(fileName);
    const data = new Uint8Array(await entry.blob.arrayBuffer());
    const crc = crc32(data);
    const size = data.byteLength;

    // Local File Header (30 bytes + filename)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // Local header signature
    lv.setUint16(4, 20, true); // Version needed (2.0)
    lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lv.setUint16(8, 0, true); // Compression: STORE (0)
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    // Central Directory Header (46 bytes + filename)
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // Central directory signature
    cv.setUint16(4, 20, true); // Version made by
    cv.setUint16(6, 20, true); // Version needed
    cv.setUint16(8, 0x0800, true); // UTF-8 flag
    cv.setUint16(10, 0, true); // Compression: STORE
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, data);
    centralParts.push(centralHeader);
    offset += localHeader.byteLength + data.byteLength;
  }

  const centralSize = centralParts.reduce((acc, part) => acc + part.byteLength, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // End of central directory signature
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return new Blob(
    [...localParts, ...centralParts, eocd] as BlobPart[],
    { type: 'application/zip' }
  );
}
