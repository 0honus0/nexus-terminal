export const normalizeEditorEncoding = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

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

const encodeUtf16 = (content: string, littleEndian: boolean): Uint8Array => {
  const bytes = new Uint8Array(content.length * 2 + 2);
  bytes[0] = littleEndian ? 0xff : 0xfe;
  bytes[1] = littleEndian ? 0xfe : 0xff;
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    const offset = index * 2 + 2;
    bytes[offset] = littleEndian ? code & 0xff : code >>> 8;
    bytes[offset + 1] = littleEndian ? code >>> 8 : code & 0xff;
  }
  return bytes;
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

export const encodeEditorContent = async (content: string, encoding: string): Promise<Uint8Array> => {
  const normalized = normalizeEditorEncoding(encoding);
  const contentWithoutBom = content.startsWith('\uFEFF') ? content.slice(1) : content;
  if (normalized === 'utf8') return new TextEncoder().encode(contentWithoutBom);
  if (normalized === 'utf16le') return encodeUtf16(contentWithoutBom, true);
  if (normalized === 'utf16be') return encodeUtf16(contentWithoutBom, false);

  const { iconv, Buffer } = await loadEditorCodec();
  const encodingName = iconv.encodingExists(normalized) ? normalized : 'utf8';
  const encoded = Buffer.from(iconv.encode(contentWithoutBom, encodingName));
  return new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength).slice();
};
