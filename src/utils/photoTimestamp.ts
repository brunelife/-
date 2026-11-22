export interface KstPhotoTimestamp {
  /** YYYY-MM in KST (Asia/Seoul) */
  ym: string;
  /** YYYY-MM-DD in KST (Asia/Seoul) */
  ymd: string;
  /** Readable Korean date e.g. "2026년 10월 5일" */
  koreanDate: string;
  /** Readable Korean date+time e.g. "2026.10.05 14:23" */
  compactDateTime: string;
  /** Readable Korean date+time e.g. "2026년 10월 5일 오후 2:23" */
  koreanDateTime: string;
  /** Where the timestamp came from */
  source: 'exif' | 'file' | 'now';
}

function formatDateToKst(
  date: Date,
  source: 'exif' | 'file' | 'now'
): KstPhotoTimestamp {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hourNum = Number(get('hour'));
  const minute = get('minute');

  const monthNum = Number(month);
  const dayNum = Number(day);
  const ampm = hourNum < 12 ? '오전' : '오후';
  const hour12 = hourNum % 12 === 0 ? 12 : hourNum % 12;

  return {
    ym: `${year}-${month}`,
    ymd: `${year}-${month}-${day}`,
    koreanDate: `${year}년 ${monthNum}월 ${dayNum}일`,
    compactDateTime: `${year}.${month}.${day} ${String(hourNum).padStart(2, '0')}:${minute}`,
    koreanDateTime: `${year}년 ${monthNum}월 ${dayNum}일 ${ampm} ${hour12}:${minute}`,
    source,
  };
}

export function getNowKstTimestamp(): KstPhotoTimestamp {
  return formatDateToKst(new Date(), 'now');
}

function readAscii(view: DataView, start: number, length: number): string {
  let out = '';
  const end = Math.min(view.byteLength, start + length);
  for (let i = start; i < end; i += 1) {
    const code = view.getUint8(i);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out.trim();
}

function readExifStringFromIfd(
  view: DataView,
  tiffStart: number,
  ifdOffset: number,
  littleEndian: boolean,
  targetTags: Set<number>
): Map<number, string> {
  const found = new Map<number, string>();
  const dirStart = tiffStart + ifdOffset;
  if (dirStart + 2 > view.byteLength) return found;

  const entryCount = view.getUint16(dirStart, littleEndian);
  for (let i = 0; i < entryCount; i += 1) {
    const entryOffset = dirStart + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;

    const tag = view.getUint16(entryOffset, littleEndian);
    const type = view.getUint16(entryOffset + 2, littleEndian);
    const count = view.getUint32(entryOffset + 4, littleEndian);

    if (targetTags.has(tag) && type === 2 && count > 0 && count < 64) {
      let strStart: number;
      if (count <= 4) {
        strStart = entryOffset + 8;
      } else {
        const valueOffset = view.getUint32(entryOffset + 8, littleEndian);
        strStart = tiffStart + valueOffset;
      }
      if (strStart >= 0 && strStart < view.byteLength) {
        const val = readAscii(view, strStart, count);
        if (val) found.set(tag, val);
      }
    }
  }
  return found;
}

function findTagUint32(
  view: DataView,
  tiffStart: number,
  ifdOffset: number,
  littleEndian: boolean,
  targetTag: number
): number | null {
  const dirStart = tiffStart + ifdOffset;
  if (dirStart + 2 > view.byteLength) return null;

  const entryCount = view.getUint16(dirStart, littleEndian);
  for (let i = 0; i < entryCount; i += 1) {
    const entryOffset = dirStart + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;
    const tag = view.getUint16(entryOffset, littleEndian);
    if (tag === targetTag) {
      return view.getUint32(entryOffset + 8, littleEndian);
    }
  }
  return null;
}

function parseExifDateString(
  rawDate: string,
  rawOffset?: string
): Date | null {
  // Standard EXIF format: "YYYY:MM:DD HH:MM:SS"
  const m = rawDate.match(
    /^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/
  );
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);

  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  // If EXIF OffsetTimeOriginal is present (e.g., "+09:00", "-08:00", "Z"), use it;
  // otherwise assume Korean local camera time (+09:00).
  let tz = '+09:00';
  if (rawOffset) {
    const cleanTz = rawOffset.trim();
    if (cleanTz === 'Z' || /^[+-]\d{2}:\d{2}$/.test(cleanTz)) {
      tz = cleanTz;
    }
  }

  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${tz}`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function extractJpegExifDate(buffer: ArrayBuffer): Date | null {
  const view = new DataView(buffer);
  if (view.byteLength < 12 || view.getUint16(0, false) !== 0xffd8) {
    return null;
  }

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset, false);
    offset += 2;

    if (marker === 0xffda || marker === 0xffd9) {
      break;
    }
    if ((marker & 0xff00) !== 0xff00) {
      break;
    }

    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || offset + segmentLength > view.byteLength) {
      break;
    }

    // APP1 EXIF segment
    if (marker === 0xffe1 && segmentLength > 10) {
      const exifHeader = readAscii(view, offset + 2, 6);
      if (exifHeader === 'Exif') {
        const tiffStart = offset + 8;
        if (tiffStart + 8 > view.byteLength) return null;

        const byteOrder = view.getUint16(tiffStart, false);
        const littleEndian = byteOrder === 0x4949;
        if (!littleEndian && byteOrder !== 0x4d4d) return null;

        const firstIfdOffset = view.getUint32(tiffStart + 4, littleEndian);
        const exifIfdOffset = findTagUint32(
          view,
          tiffStart,
          firstIfdOffset,
          littleEndian,
          0x8769 // ExifIFDPointer
        );

        if (exifIfdOffset !== null) {
          const exifTags = readExifStringFromIfd(
            view,
            tiffStart,
            exifIfdOffset,
            littleEndian,
            new Set([0x9003, 0x9004, 0x9011, 0x9012])
          );
          const dtOrig = exifTags.get(0x9003) || exifTags.get(0x9004);
          const tzOrig = exifTags.get(0x9011) || exifTags.get(0x9012);
          if (dtOrig) {
            const d = parseExifDateString(dtOrig, tzOrig);
            if (d) return d;
          }
        }

        const ifd0Tags = readExifStringFromIfd(
          view,
          tiffStart,
          firstIfdOffset,
          littleEndian,
          new Set([0x0132]) // DateTime
        );
        const dt0 = ifd0Tags.get(0x0132);
        if (dt0) {
          const d = parseExifDateString(dt0);
          if (d) return d;
        }
      }
    }

    offset += segmentLength;
  }

  return null;
}

/**
 * Extracts capture date/time from a photo file (EXIF DateTimeOriginal first, then file.lastModified,
 * then current time) and formats it strictly in Korean Standard Time (Asia/Seoul).
 */
export async function extractPhotoTimestampKst(
  file: File
): Promise<KstPhotoTimestamp> {
  try {
    const headerSlice = file.slice(0, 131072);
    const buffer = await headerSlice.arrayBuffer();
    const exifDate = extractJpegExifDate(buffer);
    if (exifDate) {
      return formatDateToKst(exifDate, 'exif');
    }
  } catch {
    // Fall back to file.lastModified below
  }

  if (typeof file.lastModified === 'number' && file.lastModified > 946684800000) {
    const fileDate = new Date(file.lastModified);
    if (!Number.isNaN(fileDate.getTime())) {
      return formatDateToKst(fileDate, 'file');
    }
  }

  return getNowKstTimestamp();
}
