/**
 * fileManagerDisplayUtils 单元测试
 * 测试文件大小格式化、权限格式化、文件图标映射
 */
import { describe, it, expect } from 'vitest';
import {
  formatSize,
  formatMode,
  getFileIconClassBase,
  FILE_ICON_CLASS_MAP,
} from './fileManagerDisplayUtils';

describe('formatSize', () => {
  it('应格式化字节', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1023)).toBe('1023 B');
  });

  it('应格式化 KB', () => {
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(1024 * 1023)).toBe('1023.0 KB');
  });

  it('应格式化 MB', () => {
    expect(formatSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatSize(1024 * 1024 * 5.5)).toBe('5.5 MB');
  });

  it('应格式化 GB', () => {
    expect(formatSize(1024 * 1024 * 1024)).toBe('1.0 GB');
    expect(formatSize(1024 * 1024 * 1024 * 2.5)).toBe('2.5 GB');
  });
});

describe('formatMode', () => {
  it('应格式化标准权限', () => {
    // 0755 = rwxr-xr-x
    expect(formatMode(0o755)).toBe('rwxr-xr-x');
  });

  it('应格式化只读权限', () => {
    // 0444 = r--r--r--
    expect(formatMode(0o444)).toBe('r--r--r--');
  });

  it('应格式化无权限', () => {
    expect(formatMode(0o000)).toBe('---------');
  });

  it('应格式化完全权限', () => {
    expect(formatMode(0o777)).toBe('rwxrwxrwx');
  });

  it('应格式化写权限', () => {
    // 0200 = -w-------
    expect(formatMode(0o200)).toBe('-w-------');
  });

  it('应格式化执行权限', () => {
    // 0100 = --x------
    expect(formatMode(0o100)).toBe('--x------');
  });
});

describe('getFileIconClassBase', () => {
  it('应返回图片文件图标', () => {
    expect(getFileIconClassBase('photo.jpg')).toBe('fas fa-file-image');
    expect(getFileIconClassBase('image.png')).toBe('fas fa-file-image');
    expect(getFileIconClassBase('icon.svg')).toBe('fas fa-file-image');
  });

  it('应返回视频文件图标', () => {
    expect(getFileIconClassBase('video.mp4')).toBe('fas fa-file-video');
    expect(getFileIconClassBase('movie.mkv')).toBe('fas fa-file-video');
  });

  it('应返回音频文件图标', () => {
    expect(getFileIconClassBase('song.mp3')).toBe('fas fa-file-audio');
    expect(getFileIconClassBase('audio.wav')).toBe('fas fa-file-audio');
  });

  it('应返回文档文件图标', () => {
    expect(getFileIconClassBase('doc.docx')).toBe('fas fa-file-word');
    expect(getFileIconClassBase('sheet.xlsx')).toBe('fas fa-file-excel');
    expect(getFileIconClassBase('slides.pptx')).toBe('fas fa-file-powerpoint');
    expect(getFileIconClassBase('report.pdf')).toBe('fas fa-file-pdf');
  });

  it('应返回压缩文件图标', () => {
    expect(getFileIconClassBase('archive.zip')).toBe('fas fa-file-archive');
    expect(getFileIconClassBase('backup.tar')).toBe('fas fa-file-archive');
    expect(getFileIconClassBase('data.gz')).toBe('fas fa-file-archive');
  });

  it('应返回代码文件图标', () => {
    expect(getFileIconClassBase('script.js')).toBe('fab fa-js-square');
    expect(getFileIconClassBase('app.ts')).toBe('fas fa-file-code');
    expect(getFileIconClassBase('component.tsx')).toBe('fab fa-react');
    expect(getFileIconClassBase('page.vue')).toBe('fab fa-vuejs');
    expect(getFileIconClassBase('main.py')).toBe('fab fa-python');
    expect(getFileIconClassBase('App.java')).toBe('fab fa-java');
  });

  it('应返回样式文件图标', () => {
    expect(getFileIconClassBase('style.css')).toBe('fab fa-css3-alt');
    expect(getFileIconClassBase('theme.scss')).toBe('fab fa-sass');
  });

  it('应返回配置文件图标', () => {
    expect(getFileIconClassBase('config.json')).toBe('fas fa-file-code');
    expect(getFileIconClassBase('settings.yaml')).toBe('fas fa-cog');
    expect(getFileIconClassBase('config.ini')).toBe('fas fa-cog');
  });

  it('应返回特殊文件图标', () => {
    expect(getFileIconClassBase('Makefile')).toBe('fas fa-cogs');
    expect(getFileIconClassBase('Dockerfile')).toBe('fab fa-docker');
    expect(getFileIconClassBase('package.json')).toBe('fab fa-npm');
    expect(getFileIconClassBase('.gitignore')).toBe('fab fa-git-alt');
    expect(getFileIconClassBase('.env')).toBe('fas fa-shield-alt');
    expect(getFileIconClassBase('README.md')).toBe('fas fa-book-reader');
    expect(getFileIconClassBase('LICENSE')).toBe('fas fa-balance-scale');
  });

  it('应返回默认图标（未知扩展名）', () => {
    expect(getFileIconClassBase('unknown.xyz')).toBe('far fa-file');
  });

  it('应处理无扩展名文件', () => {
    expect(getFileIconClassBase('Makefile')).toBe('fas fa-cogs');
    expect(getFileIconClassBase('unknownfile')).toBe('far fa-file');
  });

  it('应处理隐藏文件（以点开头）', () => {
    expect(getFileIconClassBase('.bashrc')).toBe('fas fa-cog');
    expect(getFileIconClassBase('.vimrc')).toBe('fas fa-cog');
    expect(getFileIconClassBase('.gitconfig')).toBe('fab fa-git-alt');
  });

  it('应处理大小写不敏感', () => {
    expect(getFileIconClassBase('FILE.JPG')).toBe('fas fa-file-image');
    expect(getFileIconClassBase('Script.PY')).toBe('fab fa-python');
  });

  it('docker-compose 文件应返回 Docker 图标', () => {
    expect(getFileIconClassBase('docker-compose.yml')).toBe('fab fa-docker');
    expect(getFileIconClassBase('docker-compose.yaml')).toBe('fab fa-docker');
  });
});

describe('FILE_ICON_CLASS_MAP', () => {
  it('应包含默认图标', () => {
    expect(FILE_ICON_CLASS_MAP.default).toBe('far fa-file');
  });

  it('应包含常见扩展名映射', () => {
    expect(FILE_ICON_CLASS_MAP.js).toBeDefined();
    expect(FILE_ICON_CLASS_MAP.ts).toBeDefined();
    expect(FILE_ICON_CLASS_MAP.py).toBeDefined();
    expect(FILE_ICON_CLASS_MAP.html).toBeDefined();
    expect(FILE_ICON_CLASS_MAP.css).toBeDefined();
  });
});
