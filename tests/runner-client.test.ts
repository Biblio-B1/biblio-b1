import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPILE_TIMEOUT_TEXT, EngineError, RunnerLane } from "@/components/training/runner-client";

// Faux Web Worker : enregistre les messages reçus ; le test décide des réponses.
type Listener = (e: { data: unknown }) => void;
class FakeWorker {
  static all: FakeWorker[] = [];
  listeners = new Map<string, Set<Listener>>();
  sent: { id: number; type?: string }[] = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  addEventListener(t: string, fn: Listener) {
    if (!this.listeners.has(t)) this.listeners.set(t, new Set());
    this.listeners.get(t)!.add(fn);
  }
  removeEventListener(t: string, fn: Listener) {
    this.listeners.get(t)?.delete(fn);
  }
  postMessage(m: { id: number; type?: string }) {
    this.sent.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  emit(data: unknown) {
    for (const fn of this.listeners.get("message") ?? []) fn({ data });
  }
}

beforeEach(() => {
  FakeWorker.all = [];
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("RunnerLane", () => {
  it("dispose() rejette la requête en cours avec EngineError et termine le worker", async () => {
    const lane = new RunnerLane("python", 5000);
    const p = lane.run("print(1)", "");
    const assertion = expect(p).rejects.toBeInstanceOf(EngineError);
    await flush();
    expect(FakeWorker.all).toHaveLength(1);
    lane.dispose();
    await assertion;
    expect(FakeWorker.all[0].terminated).toBe(true);
    await expect(lane.run("print(2)", "")).rejects.toBeInstanceOf(EngineError);
  });

  it("compilation trop longue → timedOut en phase compile avec un message distinct", async () => {
    vi.useFakeTimers();
    const lane = new RunnerLane("c", 5000);
    const p = lane.run("int main(void){return 0;}", "");
    await vi.advanceTimersByTimeAsync(0);
    const w = FakeWorker.all[0];
    const req = w.sent[0];
    w.emit({ id: req.id, type: "phase", phase: "compile" });
    await vi.advanceTimersByTimeAsync(31_000);
    const r = await p;
    expect(r).toMatchObject({ timedOut: true, phase: "compile", stderr: COMPILE_TIMEOUT_TEXT });
    expect(w.terminated).toBe(true);
    lane.dispose();
  });

  it("boucle infinie en phase run → délai dépassé après timeoutMs", async () => {
    vi.useFakeTimers();
    const lane = new RunnerLane("python", 5000);
    const p = lane.run("while True: pass", "");
    await vi.advanceTimersByTimeAsync(0);
    const w = FakeWorker.all[0];
    w.emit({ id: w.sent[0].id, type: "phase", phase: "run" });
    await vi.advanceTimersByTimeAsync(5_001);
    const r = await p;
    expect(r.timedOut).toBe(true);
    expect(r.phase).toBe("run");
    expect(r.stderr).toMatch(/Délai dépassé/);
    lane.dispose();
  });
});
