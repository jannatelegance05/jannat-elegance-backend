const hasPrefix = (buffer, bytes) => bytes.every((byte, index) => buffer[index] === byte);
export function hasAllowedImageSignature(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  const jpeg = hasPrefix(buffer, [0xff, 0xd8, 0xff]);
  const png = hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const webp = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return jpeg || png || webp;
}
