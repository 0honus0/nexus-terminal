import http from 'node:http';
import net from 'node:net';
import { createWriteStream } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const e2eRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(e2eRoot, '../..');
const rootDir = path.join(e2eRoot, '.tmp', 'ssh-root');
const shellRcPath = path.join(e2eRoot, '.tmp', 'ssh-bashrc');
const archiveExecHoldPath = path.join(e2eRoot, '.tmp', 'archive-exec-hold.flag');
const archivePreflightHoldPath = path.join(e2eRoot, '.tmp', 'archive-preflight-hold.flag');
const requireFromBackend = createRequire(path.join(repoRoot, 'packages', 'backend', 'package.json'));
const {
  Server,
  utils: { sftp: { OPEN_MODE, STATUS_CODE } },
} = requireFromBackend('ssh2');
const { ZipArchive } = requireFromBackend('archiver');

const SSH_HOST = '127.0.0.1';
const SSH_PORT = 22222;
const CONTROL_PORT = 22223;
const USERNAME = 'e2e';
const PASSWORD = 'e2e-password';
let statusSample = 0;
let sftpWriteDelayMs = 0;
let archiveExecDelayMs = 0;
const executedCommands = [];
const receivedWebhooks = [];
const activeSshClients = new Set();
const activeSftpChannels = new Set();
let openedSftpChannels = 0;
let sshServerOnline = false;

const virtualShellPrelude = `
cd() {
  local args=("$@")
  local original_path=''
  local index=0
  while [ "$index" -lt "\${#args[@]}" ]; do
    if [[ "\${args[$index]}" == -* ]]; then
      index=$((index + 1))
      continue
    fi
    original_path="\${args[$index]}"
    if [[ "$original_path" == /* ]] && [[ "$original_path" != "$NEXUS_E2E_ROOT"* ]]; then
      args[$index]="$NEXUS_E2E_ROOT$original_path"
    fi
    break
  done
  builtin cd "\${args[@]}" || return $?
  if [[ "$original_path" == /* ]] && [[ "$original_path" != "$NEXUS_E2E_ROOT"* ]]; then
    PWD="$original_path"
  fi
}
pwd() {
  local p
  p=$(builtin pwd "$@") || return $?
  case "$p" in
    "$NEXUS_E2E_ROOT") printf '/\\n' ;;
    "$NEXUS_E2E_ROOT"/*) printf '%s\\n' "\${p:\${#NEXUS_E2E_ROOT}}" ;;
    *) printf '%s\\n' "$p" ;;
  esac
}
readlink() {
  local p status
  p=$(command readlink "$@")
  status=$?
  [ "$status" -eq 0 ] || return "$status"
  case "$p" in
    "$NEXUS_E2E_ROOT") printf '/' ;;
    "$NEXUS_E2E_ROOT"/*) printf '%s' "\${p:\${#NEXUS_E2E_ROOT}}" ;;
    *) printf '%s' "$p" ;;
  esac
}
`;

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const hostKey = privateKey.export({ type: 'pkcs1', format: 'pem' });

function normalizeRemotePath(remotePath = '.') {
  const raw = String(remotePath || '.').replace(/\\/g, '/');
  if (raw === '.' || raw === './') return '';
  const normalized = path.posix.normalize(raw.startsWith('/') ? raw : `/${raw}`);
  return normalized === '/' ? '' : normalized.slice(1);
}

function resolveRemotePath(remotePath = '.') {
  const relativePath = normalizeRemotePath(remotePath);
  const resolved = path.resolve(rootDir, relativePath);
  const rootWithSeparator = `${path.resolve(rootDir)}${path.sep}`;
  if (resolved !== path.resolve(rootDir) && !resolved.startsWith(rootWithSeparator)) {
    throw new Error(`Path escapes test SSH root: ${remotePath}`);
  }
  return resolved;
}

function virtualPath(remotePath = '.') {
  const relativePath = normalizeRemotePath(remotePath);
  return relativePath ? `/${relativePath.split(path.sep).join('/')}` : '/';
}

function remapArchiveExecWorkingDirectory(command) {
  if (!command.includes('__NEXUS_ARCHIVE_TOTAL__:')) return command;

  return command.replace(
    /^cd\s+'([^']*)'(?=\s*(?:\|\||&&))/,
    (_match, remoteDirectory) => `cd ${JSON.stringify(resolveRemotePath(remoteDirectory))}`,
  );
}

function attrsFromStats(stats) {
  return {
    mode: stats.mode,
    uid: stats.uid ?? 1000,
    gid: stats.gid ?? 1000,
    size: stats.size,
    atime: Math.floor(stats.atimeMs / 1000),
    mtime: Math.floor(stats.mtimeMs / 1000),
  };
}

function statusForError(error) {
  if (error?.code === 'ENOENT') return STATUS_CODE.NO_SUCH_FILE;
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return STATUS_CODE.PERMISSION_DENIED;
  return STATUS_CODE.FAILURE;
}

async function writeXlsxFixture(destination, variant = 'default') {
  const columnName = (index) => {
    let value = index + 1;
    let result = '';
    while (value > 0) {
      value -= 1;
      result = String.fromCharCode(65 + (value % 26)) + result;
      value = Math.floor(value / 26);
    }
    return result;
  };
  const buildWorksheetXml = (sheetLabel, rows = 40, columns = 16) => {
    const rowXml = [];
    for (let row = 1; row <= rows; row += 1) {
      const cells = [];
      for (let column = 0; column < columns; column += 1) {
        const ref = `${columnName(column)}${row}`;
        let value = `${sheetLabel}-${ref}`;
        if (sheetLabel === 'E2E' && ref === 'A2') value = variant === 'refresh' ? 'Nexus XLSX Refreshed' : 'Nexus XLSX E2E';
        if (sheetLabel === 'E2E' && ref === 'B2') {
          cells.push(`<c r="${ref}"><v>2026</v></c>`);
          continue;
        }
        if (sheetLabel === 'Second' && ref === 'A1') value = variant === 'refresh' ? 'Second Sheet Refreshed' : 'Second Sheet E2E';
        cells.push(`<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`);
      }
      rowXml.push(`<row r="${row}">${cells.join('')}</row>`);
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + `<dimension ref="A1:${columnName(columns - 1)}${rows}"/><sheetData>`
      + rowXml.join('')
      + '</sheetData></worksheet>';
  };

  await new Promise((resolve, reject) => {
    const output = createWriteStream(destination);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '</Types>',
      { name: '[Content_Types].xml' },
    );
    archive.append(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>',
      { name: '_rels/.rels' },
    );
    archive.append(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
      + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets><sheet name="E2E" sheetId="1" r:id="rId1"/>'
      + '<sheet name="Second" sheetId="2" r:id="rId2"/></sheets></workbook>',
      { name: 'xl/workbook.xml' },
    );
    archive.append(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
      + '</Relationships>',
      { name: 'xl/_rels/workbook.xml.rels' },
    );
    archive.append(buildWorksheetXml('E2E'), { name: 'xl/worksheets/sheet1.xml' });
    archive.append(buildWorksheetXml('Second'), { name: 'xl/worksheets/sheet2.xml' });
    void archive.finalize();
  });
}

async function writeCompactXlsxFixture(destination) {
  const worksheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<dimension ref="A1:B2"/><sheetData>'
    + '<row r="1"><c r="A1" t="inlineStr"><is><t>Compact A1</t></is></c><c r="B1" t="inlineStr"><is><t>Compact B1</t></is></c></row>'
    + '<row r="2"><c r="A2" t="inlineStr"><is><t>Compact A2</t></is></c><c r="B2" t="inlineStr"><is><t>Compact B2</t></is></c></row>'
    + '</sheetData></worksheet>';

  await new Promise((resolve, reject) => {
    const output = createWriteStream(destination);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '</Types>',
      { name: '[Content_Types].xml' },
    );
    archive.append(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>',
      { name: '_rels/.rels' },
    );
    archive.append(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets><sheet name="Only" sheetId="1" r:id="rId1"/></sheets></workbook>',
      { name: 'xl/workbook.xml' },
    );
    archive.append(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '</Relationships>',
      { name: 'xl/_rels/workbook.xml.rels' },
    );
    archive.append(worksheetXml, { name: 'xl/worksheets/sheet1.xml' });
    void archive.finalize();
  });
}

async function writeDocxFixture(destination, variant = 'default') {
  await new Promise((resolve, reject) => {
    const output = createWriteStream(destination);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      + '</Types>',
      { name: '[Content_Types].xml' },
    );
    archive.append(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
      + '</Relationships>',
      { name: '_rels/.rels' },
    );
    archive.append(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + '<w:body>'
      + `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>${variant === 'refresh' ? 'Nexus DOCX Refreshed' : 'Nexus DOCX E2E'}</w:t></w:r></w:p>`
      + `<w:p><w:r><w:t>${variant === 'refresh' ? 'DOCX force refresh loaded the external update.' : 'DOCX preview tabs preserve document content.'}</w:t></w:r></w:p>`
      + '<w:tbl><w:tblPr><w:tblW w:w="16500" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>'
      + '<w:tblGrid><w:gridCol w:w="5500"/><w:gridCol w:w="5500"/><w:gridCol w:w="5500"/></w:tblGrid>'
      + '<w:tr>'
      + '<w:tc><w:tcPr><w:tcW w:w="5500" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Wide DOCX Column A</w:t></w:r></w:p></w:tc>'
      + '<w:tc><w:tcPr><w:tcW w:w="5500" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Wide DOCX Column B</w:t></w:r></w:p></w:tc>'
      + '<w:tc><w:tcPr><w:tcW w:w="5500" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Wide DOCX Column C</w:t></w:r></w:p></w:tc>'
      + '</w:tr></w:tbl>'
      + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>'
      + '</w:body></w:document>',
      { name: 'word/document.xml' },
    );
    archive.append(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>'
      + '<w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>'
      + '</w:styles>',
      { name: 'word/styles.xml' },
    );
    archive.append(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '</Relationships>',
      { name: 'word/_rels/document.xml.rels' },
    );
    void archive.finalize();
  });
}

async function writePdfFixture(destination, variant = 'default') {
  const escapePdfText = (value) => value.replace(/([\\()])/g, '\\$1');
  const streamObject = (content) => {
    const length = Buffer.byteLength(content, 'latin1');
    return `<< /Length ${length} >>\nstream\n${content}\nendstream`;
  };
  const pageStream = (title, body) => streamObject(
    'BT\n'
    + '/F1 26 Tf\n'
    + `72 700 Td (${escapePdfText(title)}) Tj\n`
    + '/F1 14 Tf\n'
    + `0 -44 Td (${escapePdfText(body)}) Tj\n`
    + 'ET',
  );

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /Outlines 10 0 R /PageMode /UseOutlines >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 8 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 9 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    pageStream(variant === 'refresh' ? 'Nexus PDF Refreshed' : 'Nexus PDF E2E', 'Introduction page'),
    pageStream(variant === 'refresh' ? 'Second Chapter Refreshed' : 'Second Chapter', 'Outline navigation target'),
    pageStream(variant === 'refresh' ? 'Details Refreshed' : 'Details', 'Nested outline target'),
    '<< /Type /Outlines /First 11 0 R /Last 12 0 R /Count 3 >>',
    `<< /Title (${variant === 'refresh' ? 'Introduction Refreshed' : 'Introduction'}) /Parent 10 0 R /Next 12 0 R /Dest [3 0 R /Fit] >>`,
    `<< /Title (${variant === 'refresh' ? 'Second Chapter Refreshed' : 'Second Chapter'}) /Parent 10 0 R /Prev 11 0 R /First 13 0 R /Last 13 0 R /Count 1 /Dest [4 0 R /Fit] >>`,
    `<< /Title (${variant === 'refresh' ? 'Details Refreshed' : 'Details'}) /Parent 12 0 R /Dest [5 0 R /Fit] >>`,
  ];

  let pdf = '%PDF-1.7\n%âãÏÓ\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += 'trailer\n';
  pdf += `<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  await fsp.writeFile(destination, Buffer.from(pdf, 'latin1'));
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function writeUnicodePathZipFixture(destination, unicodeName) {
  const legacyName = Buffer.from('legacy-name', 'ascii');
  const unicodeNameBytes = Buffer.from(unicodeName, 'utf8');
  const content = Buffer.from('unicode-path-e2e\n', 'utf8');

  // Info-ZIP Unicode Path extra field (0x7075): version + CRC32 of the
  // legacy filename + the authoritative UTF-8 filename. With LC_ALL=C,
  // unzip 6.00 renders this filename as #Uxxxx; UTF-8 locales restore it.
  const unicodePathData = Buffer.alloc(1 + 4 + unicodeNameBytes.length);
  unicodePathData[0] = 1;
  unicodePathData.writeUInt32LE(crc32(legacyName), 1);
  unicodeNameBytes.copy(unicodePathData, 5);
  const unicodePathExtra = Buffer.alloc(4 + unicodePathData.length);
  unicodePathExtra.writeUInt16LE(0x7075, 0);
  unicodePathExtra.writeUInt16LE(unicodePathData.length, 2);
  unicodePathData.copy(unicodePathExtra, 4);

  const contentCrc = crc32(content);
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(contentCrc, 14);
  localHeader.writeUInt32LE(content.length, 18);
  localHeader.writeUInt32LE(content.length, 22);
  localHeader.writeUInt16LE(legacyName.length, 26);
  localHeader.writeUInt16LE(unicodePathExtra.length, 28);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(0, 14);
  centralHeader.writeUInt32LE(contentCrc, 16);
  centralHeader.writeUInt32LE(content.length, 20);
  centralHeader.writeUInt32LE(content.length, 24);
  centralHeader.writeUInt16LE(legacyName.length, 28);
  centralHeader.writeUInt16LE(unicodePathExtra.length, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42);

  const localRecord = Buffer.concat([localHeader, legacyName, unicodePathExtra, content]);
  const centralRecord = Buffer.concat([centralHeader, legacyName, unicodePathExtra]);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(1, 8);
  endOfCentralDirectory.writeUInt16LE(1, 10);
  endOfCentralDirectory.writeUInt32LE(centralRecord.length, 12);
  endOfCentralDirectory.writeUInt32LE(localRecord.length, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  await fsp.writeFile(destination, Buffer.concat([localRecord, centralRecord, endOfCentralDirectory]));
}

async function resetRoot() {
  await fsp.rm(archiveExecHoldPath, { force: true });
  await fsp.rm(rootDir, { recursive: true, force: true });
  await fsp.mkdir(path.join(rootDir, 'folder-seed'), { recursive: true });
  await fsp.writeFile(shellRcPath, `${virtualShellPrelude}\nPS1='nexus-e2e$ '\nPROMPT_COMMAND=''\n`, 'utf8');
  await fsp.writeFile(path.join(rootDir, 'seed.txt'), 'nexus-e2e-seed\n', 'utf8');
  await fsp.writeFile(path.join(rootDir, 'plainfile'), 'plain-no-extension\n', 'utf8');
  await fsp.writeFile(path.join(rootDir, 'refresh-e2e.txt'), 'refresh-original\n', 'utf8');
  await fsp.writeFile(
    path.join(rootDir, 'utf16-crlf.txt'),
    Buffer.from('\uFEFFENCODING_E2E\r\nSECOND_LINE\r\n', 'utf16le'),
  );
  await fsp.writeFile(path.join(rootDir, 'README-e2e.md'), '# Nexus Markdown E2E\n\n**preview-ok**\n', 'utf8');
  await fsp.writeFile(path.join(rootDir, 'copy-source.txt'), 'copy-me\n', 'utf8');
  await fsp.writeFile(path.join(rootDir, 'move-source.txt'), 'move-me\n', 'utf8');
  await fsp.writeFile(path.join(rootDir, 'archive-source.txt'), 'archive-me\n', 'utf8');
  await writeUnicodePathZipFixture(path.join(rootDir, '中文解压测试.zip'), '中文解压测试');
  await fsp.mkdir(path.join(rootDir, 'deleted-cwd'), { recursive: true });
  await fsp.writeFile(path.join(rootDir, 'deleted-cwd', 'inside.txt'), 'deleted-cwd-e2e\n', 'utf8');
  await fsp.mkdir(path.join(rootDir, '  特殊 空格\'"$#`()[]{}!&;=,+测试  '), { recursive: true });
  await fsp.writeFile(
    path.join(rootDir, '  特殊 空格\'"$#`()[]{}!&;=,+测试  ', 'inside.txt'),
    'special-path-e2e\n',
    'utf8',
  );
  await fsp.writeFile(path.join(rootDir, 'folder-seed', 'nested.txt'), 'nested\n', 'utf8');
  await fsp.mkdir(path.join(rootDir, 'cross-target'), { recursive: true });
  await fsp.writeFile(path.join(rootDir, 'cross-copy.txt'), 'cross-copy-body\n', 'utf8');
  await fsp.writeFile(path.join(rootDir, 'cross-move.txt'), 'cross-move-body\n', 'utf8');
  await fsp.writeFile(
    path.join(rootDir, '预览-测试.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n+8AAAAASUVORK5CYII=', 'base64'),
  );
  await writeXlsxFixture(path.join(rootDir, 'preview.xlsx'));
  await writeCompactXlsxFixture(path.join(rootDir, 'compact-preview.xlsx'));
  await writeDocxFixture(path.join(rootDir, 'preview.docx'));
  await writePdfFixture(path.join(rootDir, 'preview.pdf'));
  await writePdfFixture(path.join(rootDir, 'folder-seed', 'second-preview.pdf'));
  await fsp.symlink('预览-测试.png', path.join(rootDir, 'image-link.png'));
  await fsp.symlink('missing-target.png', path.join(rootDir, 'stale-image-link.png'));
  await fsp.chmod(path.join(rootDir, 'seed.txt'), 0o644);
  statusSample = 0;
  executedCommands.length = 0;
  receivedWebhooks.length = 0;
  sftpWriteDelayMs = 0;
  archiveExecDelayMs = 0;
}

function openModeToFsFlags(flags) {
  const canRead = Boolean(flags & OPEN_MODE.READ);
  const canWrite = Boolean(flags & OPEN_MODE.WRITE);
  const append = Boolean(flags & OPEN_MODE.APPEND);
  const create = Boolean(flags & OPEN_MODE.CREAT);
  const truncate = Boolean(flags & OPEN_MODE.TRUNC);
  const exclusive = Boolean(flags & OPEN_MODE.EXCL);

  if (append) return canRead ? (exclusive ? 'ax+' : 'a+') : (exclusive ? 'ax' : 'a');
  if (canWrite && canRead) {
    if (create || truncate) return exclusive ? 'wx+' : 'w+';
    return 'r+';
  }
  if (canWrite) {
    if (create || truncate) return exclusive ? 'wx' : 'w';
    return 'r+';
  }
  return 'r';
}

function createHandleRegistry() {
  let nextHandleId = 1;
  const handles = new Map();

  return {
    add(value) {
      const id = nextHandleId++;
      handles.set(id, value);
      const buffer = Buffer.alloc(4);
      buffer.writeUInt32BE(id, 0);
      return buffer;
    },
    get(handle) {
      if (!Buffer.isBuffer(handle) || handle.length !== 4) return null;
      return handles.get(handle.readUInt32BE(0)) ?? null;
    },
    delete(handle) {
      if (!Buffer.isBuffer(handle) || handle.length !== 4) return null;
      const id = handle.readUInt32BE(0);
      const value = handles.get(id) ?? null;
      handles.delete(id);
      return value;
    },
  };
}

function attachSftp(session, accept) {
  const sftp = accept();
  const channelToken = Symbol('sftp-channel');
  activeSftpChannels.add(channelToken);
  openedSftpChannels += 1;
  const detachChannel = () => activeSftpChannels.delete(channelToken);
  sftp.once('end', detachChannel);
  sftp.once('close', detachChannel);
  const registry = createHandleRegistry();

  const respondError = (reqid, error) => {
    sftp.status(reqid, statusForError(error), error?.message || 'SFTP test server failure');
  };

  const statRequest = async (reqid, remotePath, useLstat = false) => {
    try {
      const fullPath = resolveRemotePath(remotePath);
      const stats = useLstat ? await fsp.lstat(fullPath) : await fsp.stat(fullPath);
      sftp.attrs(reqid, attrsFromStats(stats));
    } catch (error) {
      respondError(reqid, error);
    }
  };

  sftp.on('REALPATH', async (reqid, remotePath) => {
    try {
      const fullPath = resolveRemotePath(remotePath);
      await fsp.stat(fullPath);
      sftp.name(reqid, [{ filename: virtualPath(remotePath), longname: virtualPath(remotePath), attrs: {} }]);
    } catch (error) {
      respondError(reqid, error);
    }
  });

  sftp.on('STAT', (reqid, remotePath) => void statRequest(reqid, remotePath, false));
  sftp.on('LSTAT', (reqid, remotePath) => void statRequest(reqid, remotePath, true));

  sftp.on('OPENDIR', async (reqid, remotePath) => {
    try {
      const fullPath = resolveRemotePath(remotePath);
      const entries = await fsp.readdir(fullPath, { withFileTypes: true });
      const names = [];
      for (const entry of entries) {
        const entryPath = path.join(fullPath, entry.name);
        const stats = await fsp.lstat(entryPath);
        names.push({
          filename: entry.name,
          longname: entry.name,
          attrs: attrsFromStats(stats),
        });
      }
      const handle = registry.add({ type: 'dir', entries: names, sent: false });
      sftp.handle(reqid, handle);
    } catch (error) {
      respondError(reqid, error);
    }
  });

  sftp.on('READDIR', (reqid, handle) => {
    const state = registry.get(handle);
    if (!state || state.type !== 'dir') {
      sftp.status(reqid, STATUS_CODE.FAILURE, 'Invalid directory handle');
      return;
    }
    if (state.sent) {
      sftp.status(reqid, STATUS_CODE.EOF);
      return;
    }
    state.sent = true;
    if (state.entries.length === 0) sftp.status(reqid, STATUS_CODE.EOF);
    else sftp.name(reqid, state.entries);
  });

  sftp.on('OPEN', async (reqid, remotePath, flags, attrs) => {
    try {
      const fullPath = resolveRemotePath(remotePath);
      await fsp.mkdir(path.dirname(fullPath), { recursive: true });
      const fileHandle = await fsp.open(fullPath, openModeToFsFlags(flags), attrs?.mode ? (attrs.mode & 0o7777) : 0o644);
      const handle = registry.add({ type: 'file', fileHandle, path: fullPath });
      sftp.handle(reqid, handle);
    } catch (error) {
      respondError(reqid, error);
    }
  });

  sftp.on('READ', async (reqid, handle, offset, length) => {
    const state = registry.get(handle);
    if (!state || state.type !== 'file') {
      sftp.status(reqid, STATUS_CODE.FAILURE, 'Invalid file handle');
      return;
    }
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await state.fileHandle.read(buffer, 0, length, Number(offset));
      if (bytesRead === 0) sftp.status(reqid, STATUS_CODE.EOF);
      else sftp.data(reqid, buffer.subarray(0, bytesRead));
    } catch (error) {
      respondError(reqid, error);
    }
  });

  sftp.on('WRITE', async (reqid, handle, offset, data) => {
    const state = registry.get(handle);
    if (!state || state.type !== 'file') {
      sftp.status(reqid, STATUS_CODE.FAILURE, 'Invalid file handle');
      return;
    }
    try {
      if (sftpWriteDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, sftpWriteDelayMs));
      }
      await state.fileHandle.write(data, 0, data.length, Number(offset));
      sftp.status(reqid, STATUS_CODE.OK);
    } catch (error) {
      respondError(reqid, error);
    }
  });

  sftp.on('FSTAT', async (reqid, handle) => {
    const state = registry.get(handle);
    if (!state || state.type !== 'file') {
      sftp.status(reqid, STATUS_CODE.FAILURE, 'Invalid file handle');
      return;
    }
    try {
      sftp.attrs(reqid, attrsFromStats(await state.fileHandle.stat()));
    } catch (error) {
      respondError(reqid, error);
    }
  });

  sftp.on('FSETSTAT', async (reqid, handle, attrs) => {
    const state = registry.get(handle);
    if (!state || state.type !== 'file') {
      sftp.status(reqid, STATUS_CODE.FAILURE, 'Invalid file handle');
      return;
    }
    try {
      if (typeof attrs?.mode === 'number') await state.fileHandle.chmod(attrs.mode & 0o7777);
      if (typeof attrs?.size === 'number') await state.fileHandle.truncate(attrs.size);
      sftp.status(reqid, STATUS_CODE.OK);
    } catch (error) {
      respondError(reqid, error);
    }
  });

  sftp.on('CLOSE', async (reqid, handle) => {
    const state = registry.delete(handle);
    if (!state) {
      sftp.status(reqid, STATUS_CODE.FAILURE, 'Invalid handle');
      return;
    }
    try {
      if (state.type === 'file') await state.fileHandle.close();
      sftp.status(reqid, STATUS_CODE.OK);
    } catch (error) {
      respondError(reqid, error);
    }
  });

  sftp.on('MKDIR', async (reqid, remotePath, attrs) => {
    try {
      await fsp.mkdir(resolveRemotePath(remotePath), { mode: attrs?.mode ? (attrs.mode & 0o7777) : 0o755 });
      sftp.status(reqid, STATUS_CODE.OK);
    } catch (error) {
      respondError(reqid, error);
    }
  });

  sftp.on('RMDIR', async (reqid, remotePath) => {
    try {
      await fsp.rmdir(resolveRemotePath(remotePath));
      sftp.status(reqid, STATUS_CODE.OK);
    } catch (error) {
      respondError(reqid, error);
    }
  });

  sftp.on('REMOVE', async (reqid, remotePath) => {
    try {
      await fsp.unlink(resolveRemotePath(remotePath));
      sftp.status(reqid, STATUS_CODE.OK);
    } catch (error) {
      respondError(reqid, error);
    }
  });

  sftp.on('RENAME', async (reqid, oldRemotePath, newRemotePath) => {
    try {
      const destination = resolveRemotePath(newRemotePath);
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await fsp.rename(resolveRemotePath(oldRemotePath), destination);
      sftp.status(reqid, STATUS_CODE.OK);
    } catch (error) {
      respondError(reqid, error);
    }
  });

  sftp.on('SETSTAT', async (reqid, remotePath, attrs) => {
    try {
      const fullPath = resolveRemotePath(remotePath);
      if (typeof attrs?.mode === 'number') await fsp.chmod(fullPath, attrs.mode & 0o7777);
      if (typeof attrs?.size === 'number') await fsp.truncate(fullPath, attrs.size);
      sftp.status(reqid, STATUS_CODE.OK);
    } catch (error) {
      respondError(reqid, error);
    }
  });
}

function finishExec(stream, stdout = '', stderr = '', code = 0) {
  if (stdout) stream.write(stdout);
  if (stderr) stream.stderr.write(stderr);
  stream.exit(code);
  stream.end();
}

function buildStatusFixture() {
  statusSample += 1;
  const user = 1000 + statusSample * 80;
  const system = 500 + statusSample * 20;
  const idle = 8000 + statusSample * 100;
  const rx = 1_000_000 + statusSample * 3_000_000;
  const tx = 2_000_000 + statusSample * 2_000_000;
  return [
    '__NEXUS_STATUS_OS_RELEASE__',
    'PRETTY_NAME="Nexus E2E Linux"',
    '__NEXUS_STATUS_CPU_MODEL__',
    'Nexus Virtual CPU',
    '__NEXUS_STATUS_NET_ROUTE__',
    'Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT',
    'eth0 00000000 0100007F 0003 0 0 0 00000000 0 0 0',
    '__NEXUS_STATUS_MEMINFO__',
    'MemTotal:        2097152 kB',
    'MemFree:          524288 kB',
    'MemAvailable:    1048576 kB',
    'Buffers:           65536 kB',
    'Cached:           262144 kB',
    'SwapTotal:       1048576 kB',
    'SwapFree:         786432 kB',
    '__NEXUS_STATUS_DISK__',
    'Filesystem 1024-blocks Used Available Capacity Mounted on',
    '/dev/e2e 10485760 3145728 7340032 30% /',
    '__NEXUS_STATUS_PROC_STAT__',
    `cpu ${user} 0 ${system} ${idle} 0 0 0 0 0 0`,
    '__NEXUS_STATUS_LOADAVG__',
    '0.12 0.34 0.56 1/100 1234',
    '__NEXUS_STATUS_NET_DEV__',
    'Inter-|   Receive                                                |  Transmit',
    ' face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed',
    `  eth0: ${rx} 100 0 0 0 0 0 0 ${tx} 100 0 0 0 0 0 0`,
    '',
  ].join('\n');
}

function runRemoteCommand(command, stream) {
  executedCommands.push(String(command));
  if (command.includes('__NEXUS_STATUS_')) {
    finishExec(stream, buildStatusFixture());
    return;
  }
  if (command === "docker version --format '{{.Server.Version}}'") {
    finishExec(stream, '27.0.0\n');
    return;
  }
  if (command === "docker ps -a --no-trunc --format '{{json .}}'") {
    finishExec(stream, `${JSON.stringify({
      ID: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      Names: 'nexus-e2e-container',
      Image: 'alpine:latest',
      ImageID: 'sha256:e2e',
      Command: 'sleep 3600',
      CreatedAt: 1_700_000_000,
      State: 'running',
      Status: 'Up 10 minutes',
      Ports: '127.0.0.1:8080->80/tcp',
      Labels: 'suite=e2e',
    })}\n`);
    return;
  }
  if (command.startsWith('docker stats ')) {
    finishExec(stream, `${JSON.stringify({
      ID: '0123456789ab',
      Name: 'nexus-e2e-container',
      CPUPerc: '12.34%',
      MemUsage: '32MiB / 2GiB',
      MemPerc: '1.56%',
      NetIO: '1.2MB / 800kB',
      BlockIO: '0B / 0B',
      PIDs: '3',
    })}\n`);
    return;
  }
  if (/^docker\s+(start|stop|restart|pause|unpause|rm)\b/.test(command)) {
    finishExec(stream, 'nexus-e2e-container\n');
    return;
  }

  const executableCommand = remapArchiveExecWorkingDirectory(command);
  const isArchiveCommand = command.includes('__NEXUS_ARCHIVE_TOTAL__:');
  const normalizedArchivePreflight = String(command)
    .trim()
    .replace(/\s+>\s*\/dev\/null\s+2>&1\s*$/, '')
    .replace(/["']/g, '')
    .trim();
  const isArchivePreflightCommand = /^(?:command -v|which)\s+(?:zip|tar|unzip)\s*$/.test(normalizedArchivePreflight);
  const preflightHoldPrefix = isArchivePreflightCommand
    ? `while [ -f ${JSON.stringify(archivePreflightHoldPath)} ]; do sleep 0.05; done; `
    : '';
  const holdPrefix = isArchiveCommand
    ? `while [ -f ${JSON.stringify(archiveExecHoldPath)} ]; do sleep 0.05; done; `
    : '';
  const delayPrefix = archiveExecDelayMs > 0 && isArchiveCommand
    ? `sleep ${archiveExecDelayMs / 1000}; `
    : '';
  const delayedCommand = `${preflightHoldPrefix}${holdPrefix}${delayPrefix}${executableCommand}`;
  const child = spawn('/bin/bash', ['-lc', `${virtualShellPrelude}\n${delayedCommand}`], {
    cwd: rootDir,
    env: { ...process.env, HOME: rootDir, TERM: 'xterm-256color', NEXUS_E2E_ROOT: rootDir },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => stream.write(chunk));
  child.stderr.on('data', (chunk) => stream.stderr.write(chunk));
  stream.on('data', (chunk) => child.stdin.write(chunk));
  stream.on('close', () => child.kill('SIGTERM'));
  child.on('close', (code) => {
    stream.exit(code ?? 0);
    stream.end();
  });
}

function attachShell(session, accept) {
  const stream = accept();
  const child = spawn('/bin/bash', ['--noprofile', '--rcfile', shellRcPath, '-i'], {
    cwd: rootDir,
    env: {
      ...process.env,
      HOME: rootDir,
      TERM: 'xterm-256color',
      NEXUS_E2E_ROOT: rootDir,
      PS1: 'nexus-e2e$ ',
      PROMPT_COMMAND: '',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (data) => stream.write(data));
  child.stderr.on('data', (data) => stream.stderr.write(data));
  stream.on('data', (data) => child.stdin.write(data));
  stream.on('close', () => child.kill('SIGTERM'));
  child.on('close', (code) => {
    stream.exit(code ?? 0);
    stream.end();
  });
}

await resetRoot();

const sshServer = new Server({ hostKeys: [hostKey] }, (client) => {
  activeSshClients.add(client);
  client.once('close', () => activeSshClients.delete(client));

  client.on('authentication', (ctx) => {
    if (ctx.method === 'password' && ctx.username === USERNAME && ctx.password === PASSWORD) ctx.accept();
    else ctx.reject();
  });

  client.on('ready', () => {
    client.on('session', (accept) => {
      const session = accept();
      session.on('pty', (acceptPty) => acceptPty());
      session.on('window-change', (acceptWindowChange) => acceptWindowChange?.());
      session.on('shell', (acceptShell) => attachShell(session, acceptShell));
      session.on('exec', (acceptExec, _rejectExec, info) => runRemoteCommand(info.command, acceptExec()));
      session.on('sftp', (acceptSftp) => attachSftp(session, acceptSftp));
    });

    // Support ssh2 Client.forwardOut so this same E2E server can act as a jump host.
    client.on('tcpip', (accept, reject, info) => {
      const upstream = net.connect(info.destPort, info.destIP);
      upstream.once('connect', () => {
        const channel = accept();
        channel.once('close', () => upstream.destroy());
        upstream.once('close', () => {
          try { channel.end(); } catch { /* already closed */ }
        });
        channel.pipe(upstream).pipe(channel);
      });
      upstream.once('error', () => {
        try { reject(); } catch { /* request may already have ended */ }
      });
    });
  });

  client.on('error', (error) => {
    console.error('[E2E SSH] client error:', error.message);
  });
});

sshServer.on('error', (error) => {
  console.error('[E2E SSH] server error:', error);
  process.exitCode = 1;
});

async function startSshServer() {
  if (sshServerOnline) return;
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    sshServer.once('error', onError);
    sshServer.listen(SSH_PORT, SSH_HOST, () => {
      sshServer.off('error', onError);
      sshServerOnline = true;
      resolve();
    });
  });
}

async function stopSshServer() {
  for (const client of [...activeSshClients]) {
    try { client.end(); } catch { /* already closed */ }
  }
  if (!sshServerOnline) return;
  await new Promise((resolve, reject) => {
    sshServer.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  sshServerOnline = false;
}

const controlServer = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', `http://${SSH_HOST}:${CONTROL_PORT}`);
    if (req.method === 'GET' && requestUrl.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, sshPort: SSH_PORT, rootDir }));
      return;
    }
    if (req.method === 'POST' && requestUrl.pathname === '/reset') {
      await stopSshServer();
      sftpWriteDelayMs = 0;
      archiveExecDelayMs = 0;
      activeSftpChannels.clear();
      openedSftpChannels = 0;
      await fsp.rm(archiveExecHoldPath, { force: true });
      await fsp.rm(archivePreflightHoldPath, { force: true });
      await resetRoot();
      await startSshServer();
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'POST' && requestUrl.pathname === '/ssh/offline') {
      await stopSshServer();
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'POST' && requestUrl.pathname === '/ssh/online') {
      await startSshServer();
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'GET' && requestUrl.pathname === '/ssh/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ online: sshServerOnline, activeClients: activeSshClients.size }));
      return;
    }
    if (req.method === 'GET' && requestUrl.pathname === '/sftp/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ activeChannels: activeSftpChannels.size, openedChannels: openedSftpChannels }));
      return;
    }
    if (req.method === 'POST' && requestUrl.pathname === '/sftp/write-delay') {
      const requestedDelay = Number(requestUrl.searchParams.get('ms') || '0');
      sftpWriteDelayMs = Number.isFinite(requestedDelay)
        ? Math.max(0, Math.min(35_000, Math.round(requestedDelay)))
        : 0;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ sftpWriteDelayMs }));
      return;
    }
    if (req.method === 'POST' && requestUrl.pathname === '/archive/exec-delay') {
      const requestedDelay = Number(requestUrl.searchParams.get('ms') || '0');
      archiveExecDelayMs = Number.isFinite(requestedDelay)
        ? Math.max(0, Math.min(5000, Math.round(requestedDelay)))
        : 0;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ archiveExecDelayMs }));
      return;
    }
    if (req.method === 'POST' && requestUrl.pathname === '/archive/preflight-hold') {
      const enabled = ['1', 'true', 'yes'].includes(String(requestUrl.searchParams.get('enabled') || '').toLowerCase());
      await fsp.mkdir(path.dirname(archivePreflightHoldPath), { recursive: true });
      if (enabled) await fsp.writeFile(archivePreflightHoldPath, 'hold\n', 'utf8');
      else await fsp.rm(archivePreflightHoldPath, { force: true });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ enabled }));
      return;
    }
    if (req.method === 'POST' && requestUrl.pathname === '/archive/exec-hold') {
      const enabled = ['1', 'true', 'yes'].includes(String(requestUrl.searchParams.get('enabled') || '').toLowerCase());
      await fsp.mkdir(path.dirname(archiveExecHoldPath), { recursive: true });
      if (enabled) await fsp.writeFile(archiveExecHoldPath, 'hold\n', 'utf8');
      else await fsp.rm(archiveExecHoldPath, { force: true });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ enabled }));
      return;
    }
    if (req.method === 'POST' && requestUrl.pathname === '/fixture') {
      const name = path.basename(requestUrl.searchParams.get('name') || 'external-refresh.txt');
      const variant = String(requestUrl.searchParams.get('variant') || '');
      const requestedSize = Number(requestUrl.searchParams.get('size') || '0');
      const size = Number.isFinite(requestedSize) ? Math.max(0, Math.min(32 * 1024 * 1024, Math.round(requestedSize))) : 0;
      if (variant === 'refresh' && name === 'README-e2e.md') {
        await fsp.writeFile(path.join(rootDir, name), '# Nexus Markdown Refreshed\n\n**force-refresh-ok**\n', 'utf8');
      } else if (variant === 'refresh' && name === 'preview.xlsx') {
        await writeXlsxFixture(path.join(rootDir, name), 'refresh');
      } else if (variant === 'refresh' && name === 'preview.docx') {
        await writeDocxFixture(path.join(rootDir, name), 'refresh');
      } else if (variant === 'refresh' && name === 'preview.pdf') {
        await writePdfFixture(path.join(rootDir, name), 'refresh');
      } else if (variant === 'refresh' && name === '预览-测试.png') {
        await fsp.writeFile(
          path.join(rootDir, name),
          Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DA8J8BAAf/Af8Bf4mnAAAAAElFTkSuQmCC', 'base64'),
        );
      } else if (size > 0) {
        await fsp.writeFile(path.join(rootDir, name), Buffer.alloc(size, 0x5a));
      } else {
        await fsp.writeFile(path.join(rootDir, name), 'created outside Nexus for refresh verification\n', 'utf8');
      }
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'POST' && requestUrl.pathname === '/fixture-directory') {
      const name = path.basename(requestUrl.searchParams.get('name') || 'copy-cancel-dir');
      const requestedSize = Number(requestUrl.searchParams.get('size') || `${32 * 1024}`);
      const size = Number.isFinite(requestedSize) ? Math.max(1, Math.min(1024 * 1024, Math.round(requestedSize))) : 32 * 1024;
      const targetDir = path.join(rootDir, name);
      await fsp.rm(targetDir, { recursive: true, force: true });
      await fsp.mkdir(targetDir, { recursive: true });
      await fsp.writeFile(path.join(targetDir, '01-first.bin'), Buffer.alloc(size, 0x61));
      await fsp.writeFile(path.join(targetDir, '02-second.bin'), Buffer.alloc(size, 0x62));
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'POST' && requestUrl.pathname === '/remove-path') {
      const requestedPath = String(requestUrl.searchParams.get('path') || '');
      const targetPath = resolveRemotePath(requestedPath);
      if (targetPath === path.resolve(rootDir)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Refusing to remove the E2E root directory' }));
        return;
      }
      await fsp.rm(targetPath, { recursive: true, force: true });
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'GET' && requestUrl.pathname === '/path-exists') {
      const requestedPath = String(requestUrl.searchParams.get('path') || '').replace(/\\/g, '/');
      const normalized = path.posix.normalize(`/${requestedPath}`).replace(/^\/+/, '');
      const targetPath = path.resolve(rootDir, normalized);
      const rootPrefix = `${path.resolve(rootDir)}${path.sep}`;
      const allowed = targetPath === path.resolve(rootDir) || targetPath.startsWith(rootPrefix);
      let exists = false;
      if (allowed) {
        try { await fsp.access(targetPath); exists = true; } catch { /* absent */ }
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ exists }));
      return;
    }
    if (req.method === 'GET' && requestUrl.pathname === '/files') {
      const files = await fsp.readdir(rootDir);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ files }));
      return;
    }
    if (req.method === 'GET' && requestUrl.pathname === '/commands') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ commands: [...executedCommands] }));
      return;
    }
    if (req.method === 'POST' && requestUrl.pathname === '/e2e-notification-webhook') {
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      receivedWebhooks.push({
        method: req.method,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'GET' && requestUrl.pathname === '/webhooks') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ webhooks: [...receivedWebhooks] }));
      return;
    }
    if (req.method === 'GET' && requestUrl.pathname === '/read') {
      const name = path.basename(requestUrl.searchParams.get('name') || '');
      const data = await fsp.readFile(path.join(rootDir, name));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ name, base64: data.toString('base64') }));
      return;
    }
    if (req.method === 'GET' && requestUrl.pathname === '/stat') {
      const name = requestUrl.searchParams.get('name') || '';
      const stats = await fsp.stat(resolveRemotePath(name));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        name,
        size: stats.size,
        mode: stats.mode & 0o7777,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

// The control HTTP server also doubles as a minimal HTTP CONNECT proxy for SSH transport E2E.
controlServer.on('connect', (req, clientSocket, head) => {
  const [host, rawPort] = String(req.url || '').split(':');
  const port = Number(rawPort);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }

  const upstream = net.connect(port, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length > 0) upstream.write(head);
    clientSocket.pipe(upstream).pipe(clientSocket);
  });
  upstream.once('error', () => clientSocket.destroy());
  clientSocket.once('error', () => upstream.destroy());
});

await startSshServer();
await new Promise((resolve) => controlServer.listen(CONTROL_PORT, SSH_HOST, resolve));
console.log(`[E2E SSH] listening on ${SSH_HOST}:${SSH_PORT}, control ${CONTROL_PORT}, root ${rootDir}`);

const shutdown = () => {
  controlServer.close();
  sshServer.close();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
