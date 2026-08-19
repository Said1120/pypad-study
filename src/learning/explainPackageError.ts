export function explainPackageError(message: string, online: boolean): string {
  if (!online || /failed to fetch|network|offline/i.test(message)) return '当前未联网，而且这个扩展包尚未完整缓存。联网后重试。'
  if (/quota|storage|space|容量|空间/i.test(message)) return '设备缓存空间不足。请释放空间、导出项目备份后重试。'
  if (/version|dependency|conflict|版本|依赖/i.test(message)) return '扩展包版本冲突。请更新 PyPad 后重试，不要混用其他版本资源。'
  if (/webassembly|wasm|platform|unsupported|incompatible/i.test(message)) return '当前浏览器与这个扩展包的 WebAssembly 不兼容。'
  return `扩展包准备失败：${message}`
}
