import { dlopen, ptr, read } from "bun:ffi";
import { getSystemErrorName } from "node:util";

// Darwin 的 RENAME_EXCL 同时支持文件和目录。
const library = dlopen("/usr/lib/libSystem.B.dylib", {
  renamex_np: { args: ["ptr", "ptr", "u32"], returns: "i32" },
  __error: { args: [], returns: "ptr" },
});

export function renameExclusive(source: string, target: string) {
  if (source.includes("\0") || target.includes("\0")) throw new TypeError("文件路径不能包含空字节");
  const from = Buffer.from(source + "\0");
  const to = Buffer.from(target + "\0");
  const errno = library.symbols.__error()!;
  if (library.symbols.renamex_np(ptr(from), ptr(to), 4) === 0) return;
  const code = getSystemErrorName(-read.i32(errno));
  throw Object.assign(new Error(`${code}: ${source} -> ${target}`), { code });
}
