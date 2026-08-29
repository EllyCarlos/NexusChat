export const convertBufferToBase64 = (buffer: Uint8Array<ArrayBuffer>): string => {
  return Buffer.from(buffer).toString("base64");
};
