import { describe, expect, it, vi } from "vitest";
import { INACTIVITY_MS, LAST_ACTIVITY_KEY, createInactivityTracker } from "@/lib/auth/inactivity";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("session de 15 minutes sans activité", () => {
  it("la durée est de 15 minutes", () => {
    expect(INACTIVITY_MS).toBe(15 * 60_000);
  });

  it("toujours active à 14 min 59 s, expirée à 15 min", () => {
    let now = 1_000_000;
    const tracker = createInactivityTracker({ now: () => now, storage: memoryStorage(), onExpire: () => {} });
    tracker.touch();
    now += INACTIVITY_MS - 1000;
    expect(tracker.isExpired()).toBe(false);
    now += 1000;
    expect(tracker.isExpired()).toBe(true);
  });

  it("une activité repousse l'échéance", () => {
    let now = 0;
    const tracker = createInactivityTracker({ now: () => now, storage: memoryStorage(), onExpire: () => {} });
    tracker.touch();
    now += 10 * 60_000;
    tracker.touch();
    now += 10 * 60_000;
    expect(tracker.isExpired()).toBe(false);
  });

  it("onglet rouvert 20 minutes après la dernière activité : expiration immédiate au démarrage", () => {
    const now = 50 * 60_000;
    const onExpire = vi.fn();
    const storage = memoryStorage({ [LAST_ACTIVITY_KEY]: String(now - 20 * 60_000) });
    const tracker = createInactivityTracker({ now: () => now, storage, onExpire });
    const stop = tracker.start();
    expect(onExpire).toHaveBeenCalledTimes(1);
    stop();
  });

  it("expire toute seule après 15 minutes sans activité (minuterie)", () => {
    vi.useFakeTimers();
    try {
      const onExpire = vi.fn();
      const tracker = createInactivityTracker({ now: () => Date.now(), storage: memoryStorage(), onExpire });
      const stop = tracker.start();
      vi.advanceTimersByTime(INACTIVITY_MS - 1000);
      expect(onExpire).not.toHaveBeenCalled();
      vi.advanceTimersByTime(61_000);
      expect(onExpire).toHaveBeenCalledTimes(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stockage indisponible (navigation privée) : pas de plantage, l'expiration marche en mémoire", () => {
    let now = 0;
    const broken = {
      getItem: () => {
        throw new Error("bloqué");
      },
      setItem: () => {
        throw new Error("bloqué");
      },
      removeItem: () => {},
    };
    const tracker = createInactivityTracker({ now: () => now, storage: broken, onExpire: () => {} });
    expect(() => tracker.touch()).not.toThrow();
    now += INACTIVITY_MS;
    expect(tracker.isExpired()).toBe(true);
  });
});
