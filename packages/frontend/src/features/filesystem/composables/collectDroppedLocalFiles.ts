import type { LocalUploadBatch, LocalUploadFile } from '../model/filesystem';

interface DroppedItemSnapshot {
  entry?: FileSystemEntry;
  file?: File;
}

const readFileEntry = (entry: FileSystemFileEntry): Promise<File> =>
  new Promise((resolve, reject) => entry.file(resolve, reject));

const readAllDirectoryEntries = async (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> => {
  const entries: FileSystemEntry[] = [];
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return entries;
    entries.push(...batch);
  }
};

const collectEntry = async (
  entry: FileSystemEntry,
  parentDirectory: string,
  files: LocalUploadFile[],
  directories: string[],
): Promise<void> => {
  if (entry.isFile) {
    files.push({
      file: await readFileEntry(entry as FileSystemFileEntry),
      ...(parentDirectory ? { relativeDirectory: parentDirectory } : {}),
    });
    return;
  }
  if (!entry.isDirectory) return;

  const relativeDirectory = parentDirectory ? `${parentDirectory}/${entry.name}` : entry.name;
  directories.push(relativeDirectory);
  const children = await readAllDirectoryEntries((entry as FileSystemDirectoryEntry).createReader());
  for (const child of children) await collectEntry(child, relativeDirectory, files, directories);
};

/**
 * Snapshot DataTransfer items synchronously before the first awaited filesystem read.
 * Chromium/Windows can invalidate later DataTransferItem entries once the drop callback yields.
 */
const snapshotDroppedItems = (dataTransfer: DataTransfer): DroppedItemSnapshot[] => {
  const snapshots: DroppedItemSnapshot[] = [];
  const representedRootFiles = new Set<string>();

  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== 'file') continue;
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    if (entry) {
      snapshots.push({ entry });
      if (entry.isFile) representedRootFiles.add(entry.name);
      continue;
    }
    const file = item.getAsFile();
    if (file) {
      snapshots.push({ file });
      representedRootFiles.add(file.name);
    }
  }

  for (const file of Array.from(dataTransfer.files)) {
    if (representedRootFiles.has(file.name)) continue;
    snapshots.push({ file });
    representedRootFiles.add(file.name);
  }
  return snapshots;
};

export const collectDroppedLocalFiles = async (dataTransfer: DataTransfer): Promise<LocalUploadBatch> => {
  const snapshots = snapshotDroppedItems(dataTransfer);
  const files: LocalUploadFile[] = [];
  const directories: string[] = [];
  for (const snapshot of snapshots) {
    if (snapshot.entry) await collectEntry(snapshot.entry, '', files, directories);
    else if (snapshot.file) files.push({ file: snapshot.file });
  }
  return { files, directories };
};
