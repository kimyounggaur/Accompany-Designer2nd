/**
 * 음원 데이터의 SHA-256 해시(소문자 16진수 64자).
 * 같은 음원은 해시가 같으므로 저장소에 한 번만 담긴다(프로젝트가 여러 개여도, 같은 파일을 두 번 올려도).
 * 같은 Blob 객체는 한 번만 계산한다.
 */

const cache = new WeakMap<Blob, Promise<string>>();

async function compute(blob: Blob): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("이 환경에서는 음원 해시를 계산할 수 없습니다.");
  const digest = await subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function sha256Hex(blob: Blob): Promise<string> {
  let hit = cache.get(blob);
  if (!hit) {
    hit = compute(blob);
    cache.set(blob, hit);
    // 실패한 계산은 기억하지 않는다(다음에 다시 시도).
    hit.catch(() => cache.delete(blob));
  }
  return hit;
}

/**
 * 저장소 키로 쓸 음원 식별자. 해시를 계산할 수 없는 환경(보안 연결이 아닌 주소 등)에서는
 * 공유 없이 프로젝트·음원 id로 구분하는 키로 대신한다(저장은 되지만 같은 음원을 한 번만 담지는 못한다).
 */
export async function assetKey(blob: Blob, fallback: string): Promise<string> {
  try {
    return await sha256Hex(blob);
  } catch {
    return `plain:${fallback}:${blob.size}`;
  }
}
