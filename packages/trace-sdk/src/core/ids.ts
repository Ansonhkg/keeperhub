const traceIdPattern = /^[0-9a-f]{32}$/;
const spanIdPattern = /^[0-9a-f]{16}$/;
const zeroTraceId = "00000000000000000000000000000000";
const zeroSpanId = "0000000000000000";

function randomHex(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  const cryptoProvider = globalThis.crypto;

  if (cryptoProvider?.getRandomValues) {
    cryptoProvider.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

function createNonZeroHex(byteLength: number, zeroValue: string) {
  let value = randomHex(byteLength);
  while (value === zeroValue) {
    value = randomHex(byteLength);
  }
  return value;
}

export function createTraceId() {
  return createNonZeroHex(16, zeroTraceId);
}

export function createSpanId() {
  return createNonZeroHex(8, zeroSpanId);
}

export function isTraceId(value: string) {
  return traceIdPattern.test(value) && value !== zeroTraceId;
}

export function isSpanId(value: string) {
  return spanIdPattern.test(value) && value !== zeroSpanId;
}
