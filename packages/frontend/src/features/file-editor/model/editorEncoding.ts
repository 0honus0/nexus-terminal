import * as iconv from '@vscode/iconv-lite-umd';
import { Buffer } from 'buffer/';

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

export const decodeEditorRawContent = (rawContentBase64: string, encoding: string): string => {
  const bytes = Buffer.from(rawContentBase64, 'base64');
  const normalized = normalizeEditorEncoding(encoding);
  if (normalized === 'utf8') return new TextDecoder('utf-8').decode(bytes);
  if (normalized === 'utf16le') return new TextDecoder('utf-16le').decode(bytes);
  if (normalized === 'utf16be') return new TextDecoder('utf-16be').decode(bytes);
  if (iconv.encodingExists(normalized)) return iconv.decode(bytes, normalized);
  return new TextDecoder('utf-8').decode(bytes);
};

export const encodeEditorContentBase64 = (content: string, encoding: string): string => {
  const normalized = normalizeEditorEncoding(encoding);
  const encodingName = iconv.encodingExists(normalized) ? normalized : 'utf8';
  const contentWithoutBom = content.startsWith('\uFEFF') ? content.slice(1) : content;
  const encoded = iconv.encode(contentWithoutBom, encodingName);
  if (encodingName === 'utf16le') return Buffer.concat([Buffer.from([0xff, 0xfe]), encoded]).toString('base64');
  if (encodingName === 'utf16be') return Buffer.concat([Buffer.from([0xfe, 0xff]), encoded]).toString('base64');
  return Buffer.from(encoded).toString('base64');
};
