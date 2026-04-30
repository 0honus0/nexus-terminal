#!/usr/bin/env python3
"""将文件内容安全写入 GITHUB_OUTPUT，使用 UUID 分隔符避免内容冲突。"""
import os, sys, uuid

def write_output(key: str, file_path: str):
    output_file = os.environ.get("GITHUB_OUTPUT")
    if not output_file:
        print("GITHUB_OUTPUT 未设置", file=sys.stderr)
        sys.exit(1)

    content = ""
    if os.path.isfile(file_path):
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()

    delimiter = f"_{uuid.uuid4().hex}_"
    with open(output_file, "a", encoding="utf-8") as f:
        f.write(f"{key}<<{delimiter}\n")
        f.write(content)
        f.write(f"\n{delimiter}\n")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"用法: {sys.argv[0]} <output_key> <file_path>", file=sys.stderr)
        sys.exit(1)
    write_output(sys.argv[1], sys.argv[2])
