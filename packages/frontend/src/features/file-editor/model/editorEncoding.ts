export const normalizeEditorEncoding = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const ENCODING_DETECTION_SAMPLE_BYTES = 256 * 1024;

const CANONICAL_EDITOR_ENCODINGS: Record<string, string> = {
  utf8: 'utf-8',
  utf16le: 'utf-16le',
  utf16be: 'utf-16be',
  gbk: 'gbk',
  gb18030: 'gb18030',
  big5: 'big5',
  shiftjis: 'shift_jis',
  eucjp: 'euc-jp',
  euckr: 'euc-kr',
  iso88591: 'iso-8859-1',
  iso885915: 'iso-8859-15',
  cp1252: 'cp1252',
  iso88592: 'iso-8859-2',
  cp1250: 'cp1250',
  iso88595: 'iso-8859-5',
  cp1251: 'cp1251',
  koi8r: 'koi8-r',
  koi8u: 'koi8-u',
  iso88597: 'iso-8859-7',
  cp1253: 'cp1253',
  iso88599: 'iso-8859-9',
  cp1254: 'cp1254',
  iso88598: 'iso-8859-8',
  cp1255: 'cp1255',
  iso88596: 'iso-8859-6',
  cp1256: 'cp1256',
  iso88594: 'iso-8859-4',
  iso885913: 'iso-8859-13',
  cp1257: 'cp1257',
  cp1258: 'cp1258',
  tis620: 'tis-620',
  cp874: 'cp874',
};

export const canonicalEditorEncoding = (value: string): string =>
  CANONICAL_EDITOR_ENCODINGS[normalizeEditorEncoding(value)] ?? value;

let codecPromise:
  | Promise<{
      iconv: typeof import('@vscode/iconv-lite-umd');
      Buffer: typeof import('buffer/').Buffer;
    }>
  | undefined;

const loadEditorCodec = () =>
  (codecPromise ??= Promise.all([import('@vscode/iconv-lite-umd'), import('buffer/')]).then(([iconv, buffer]) => ({
    iconv,
    Buffer: buffer.Buffer,
  })));

const encodingDetectionSample = (rawContent: Uint8Array): Uint8Array => {
  if (rawContent.byteLength <= ENCODING_DETECTION_SAMPLE_BYTES) return rawContent;
  const windowSize = Math.floor(ENCODING_DETECTION_SAMPLE_BYTES / 3);
  const middleStart = Math.max(0, Math.floor((rawContent.byteLength - windowSize) / 2));
  const sample = new Uint8Array(windowSize * 3);
  sample.set(rawContent.subarray(0, windowSize), 0);
  sample.set(rawContent.subarray(middleStart, middleStart + windowSize), windowSize);
  sample.set(rawContent.subarray(rawContent.byteLength - windowSize), windowSize * 2);
  return sample;
};

export const detectEditorEncoding = async (rawContent: Uint8Array): Promise<string> => {
  if (rawContent.byteLength >= 3 && rawContent[0] === 0xef && rawContent[1] === 0xbb && rawContent[2] === 0xbf)
    return 'utf-8';
  if (rawContent.byteLength >= 2 && rawContent[0] === 0xff && rawContent[1] === 0xfe) return 'utf-16le';
  if (rawContent.byteLength >= 2 && rawContent[0] === 0xfe && rawContent[1] === 0xff) return 'utf-16be';

  const sample = encodingDetectionSample(rawContent);
  if (!sample.includes(0)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(sample);
      return 'utf-8';
    } catch {
      // Non-UTF-8 content falls through to the broader detector.
    }
  }
  const [jschardet, { iconv, Buffer }] = await Promise.all([import('jschardet'), loadEditorCodec()]);
  const detection = jschardet.detect(Buffer.from(sample).toString('latin1'));
  let detected = normalizeEditorEncoding(detection.encoding || 'utf-8');
  if (detected === 'windows1252') detected = 'cp1252';
  if (detected === 'gb2312') detected = 'gbk';
  if (detected === 'utf8' || detected === 'ascii') return 'utf-8';
  if (['gbk', 'gb2312', 'gb18030', 'big5', 'euctw'].includes(detected)) return 'gb18030';
  if ((detection.confidence || 0) < 0.9) {
    try {
      if (!iconv.decode(Buffer.from(sample), 'gb18030').includes('\uFFFD')) return 'gb18030';
    } catch {
      // Fall back to the detector-supported encoding or UTF-8 below.
    }
  }
  return canonicalEditorEncoding(iconv.encodingExists(detected) ? detected : 'utf-8');
};

export const decodeEditorDocument = async (
  rawContent: Uint8Array,
  requestedEncoding?: string,
): Promise<{ content: string; encoding: string }> => {
  const encoding = requestedEncoding
    ? canonicalEditorEncoding(requestedEncoding)
    : await detectEditorEncoding(rawContent);
  return { content: await decodeEditorRawContent(rawContent, encoding), encoding };
};

export const decodeEditorRawContent = async (rawContent: Uint8Array, encoding: string): Promise<string> => {
  const normalized = normalizeEditorEncoding(encoding);
  if (normalized === 'utf8' || normalized === 'utf16le' || normalized === 'utf16be') {
    return new TextDecoder(normalized === 'utf8' ? 'utf-8' : normalized === 'utf16le' ? 'utf-16le' : 'utf-16be').decode(
      rawContent,
    );
  }

  const { iconv, Buffer } = await loadEditorCodec();
  const bytes = Buffer.from(rawContent);
  if (iconv.encodingExists(normalized)) return iconv.decode(bytes, normalized);
  return new TextDecoder('utf-8').decode(bytes);
};
