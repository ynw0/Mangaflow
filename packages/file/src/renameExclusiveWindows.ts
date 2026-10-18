import { dlopen, ptr } from "bun:ffi";

// 不带替换标志。目标已存在时失败，临时文件完整改名后才成为正式文件。
const moveFileWriteThrough = 0x8;
const kernel32 = dlopen("kernel32.dll", {
  MoveFileExW: { args: ["ptr", "ptr", "u32"], returns: "i32" },
  GetLastError: { args: [], returns: "u32" },
});

const errorCodes: Record<number, string> = {
  2: "ENOENT",
  3: "ENOENT",
  5: "EACCES",
  32: "EBUSY",
  80: "EEXIST",
  183: "EEXIST",
  206: "ENAMETOOLONG",
};

// Windows 的独占新建。exFAT 不支持硬链接，link 会被报成 EISDIR；同目录改名不覆盖。
export function renameExclusive(source: string, target: string) {
  if (source.includes("\0") || target.includes("\0")) {
    throw Object.assign(new TypeError("文件路径不能包含空字节"), { code: "ERR_INVALID_ARG_VALUE" });
  }
  const from = Buffer.from(`${source}\0`, "utf16le");
  const to = Buffer.from(`${target}\0`, "utf16le");
  if (kernel32.symbols.MoveFileExW(ptr(from), ptr(to), moveFileWriteThrough) !== 0) return;
  const errno = kernel32.symbols.GetLastError();
  const code = errorCodes[errno] ?? "EIO";
  throw Object.assign(new Error(`${code}: exclusive rename '${source}' -> '${target}'`), { code, errno, syscall: "MoveFileExW", path: source, dest: target });
}
