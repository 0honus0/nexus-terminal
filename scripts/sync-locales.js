#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const projectRoot = process.cwd();
const localesDir = path.join(projectRoot, 'packages', 'frontend', 'src', 'locales');
const baseLocaleFile = 'zh-CN.json';
const baseLocalePath = path.join(localesDir, baseLocaleFile);

const args = new Set(process.argv.slice(2));
const shouldWrite = args.has('--write') || !args.has('--check');
const shouldStage = args.has('--stage');

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function getType(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function syncByBase(baseNode, targetNode, currentPath, changes) {
  const baseType = getType(baseNode);
  const targetType = getType(targetNode);

  if (baseType === 'array') {
    if (targetType !== 'array') {
      changes.push(`类型不一致，已重置: ${currentPath || '<root>'}`);
      return cloneJsonValue(baseNode);
    }
    return targetNode;
  }

  if (baseType === 'object') {
    const result = {};
    const targetObject = targetType === 'object' ? targetNode : {};

    if (targetType !== 'object' && targetNode !== undefined) {
      changes.push(`类型不一致，已重置: ${currentPath || '<root>'}`);
    }

    for (const key of Object.keys(baseNode)) {
      const nextPath = currentPath ? `${currentPath}.${key}` : key;
      const hasKey = Object.prototype.hasOwnProperty.call(targetObject, key);

      if (!hasKey) {
        changes.push(`缺失键，已补齐: ${nextPath}`);
        result[key] = cloneJsonValue(baseNode[key]);
        continue;
      }

      result[key] = syncByBase(baseNode[key], targetObject[key], nextPath, changes);
    }

    for (const extraKey of Object.keys(targetObject)) {
      if (!Object.prototype.hasOwnProperty.call(baseNode, extraKey)) {
        result[extraKey] = cloneJsonValue(targetObject[extraKey]);
      }
    }

    return result;
  }

  if (targetNode === undefined) {
    changes.push(`缺失键，已补齐: ${currentPath || '<root>'}`);
    return cloneJsonValue(baseNode);
  }

  if (baseType !== targetType) {
    changes.push(`类型不一致，已重置: ${currentPath || '<root>'}`);
    return cloneJsonValue(baseNode);
  }

  return targetNode;
}

function main() {
  if (!fs.existsSync(localesDir)) {
    console.error(`未找到 locale 目录: ${localesDir}`);
    process.exit(1);
  }

  if (!fs.existsSync(baseLocalePath)) {
    console.error(`未找到基准语言文件: ${baseLocalePath}`);
    process.exit(1);
  }

  let baseJson;
  try {
    baseJson = readJsonFile(baseLocalePath);
  } catch (error) {
    console.error(`基准语言 JSON 解析失败: ${baseLocalePath}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const localeFiles = fs
    .readdirSync(localesDir)
    .filter((file) => file.endsWith('.json'))
    .sort();

  let hasError = false;
  const changedFiles = [];

  for (const file of localeFiles) {
    const filePath = path.join(localesDir, file);
    let localeJson;

    try {
      localeJson = readJsonFile(filePath);
    } catch (error) {
      hasError = true;
      console.error(`JSON 语法错误: ${filePath}`);
      console.error(error instanceof Error ? error.message : String(error));
      continue;
    }

    if (file === baseLocaleFile) {
      continue;
    }

    const changes = [];
    const synced = syncByBase(baseJson, localeJson, '', changes);
    if (changes.length === 0) {
      continue;
    }

    if (shouldWrite) {
      fs.writeFileSync(filePath, `${JSON.stringify(synced, null, 2)}\n`, 'utf8');
      changedFiles.push(filePath);
      console.log(`[locale-sync] 已同步 ${file}: ${changes.length} 处`);
    } else {
      hasError = true;
      console.error(`[locale-sync] ${file} 需要同步:`);
      for (const line of changes) {
        console.error(`  - ${line}`);
      }
    }
  }

  if (!shouldWrite && hasError) {
    process.exit(1);
  }

  if (shouldWrite && shouldStage && changedFiles.length > 0) {
    const relativePaths = changedFiles.map((filePath) => path.relative(projectRoot, filePath));
    execSync(`git add ${relativePaths.map((p) => `"${p}"`).join(' ')}`, { stdio: 'inherit' });
  }

  if (!hasError) {
    console.log('[locale-sync] locale JSON 语法校验通过，键结构已同步。');
  }
}

main();
