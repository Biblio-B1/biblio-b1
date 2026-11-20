import { describe, expect, it } from "vitest";
import { attachWorkerProtocol, type BrowserWorkerRequest, type BrowserWorkerResponse, type Engine } from "@/lib/runners/browser";

function fakeScope(throwOnFirstResult = false) {
  const sent: BrowserWorkerResponse[] = [];
  let listener: ((e: { data: BrowserWorkerRequest }) => void) | null = null;
  let thrown = false;
  return {
    sent,
    send: (data: BrowserWorkerRequest) => listener?.({ data }),
    scope: {
      postMessage(m: BrowserWorkerResponse) {
        if (throwOnFirstResult && !thrown && m.type === "result") {
          thrown = true;
          throw new Error("DataCloneError");
        }
        sent.push(m);
      },
      addEventListener(_t: "message", fn: (e: { data: BrowserWorkerRequest }) => void) {
        listener = fn;
      },
    },
  };
}

const engine = (prepared: string[] = []): Engine => ({
  async prepare(lang) {
    prepared.push(lang);
  },
  async execute(_lang, code, _stdin, onPhase) {
    onPhase?.("run");
    return { ok: true, stdout: code, stderr: "", phase: "run", timedOut: false, exitCode: 0, durationMs: 0 };
  },
});

const tick = () => new Promise((r) => setTimeout(r, 10));

describe("attachWorkerProtocol (navigateur)", () => {
  it("prepare → ready, sans exécution", async () => {
    const prepared: string[] = [];
    const f = fakeScope();
    attachWorkerProtocol(f.scope, engine(prepared));
    f.send({ id: 1, type: "prepare", lang: "python" });
    await tick();
    expect(prepared).toEqual(["python"]);
    expect(f.sent).toEqual([{ id: 1, type: "ready" }]);
  });

  it("un postMessage qui lève ne bloque pas les requêtes suivantes", async () => {
    const f = fakeScope(true);
    attachWorkerProtocol(f.scope, engine());
    f.send({ id: 1, lang: "javascript", code: "a", stdin: "" });
    f.send({ id: 2, lang: "javascript", code: "b", stdin: "" });
    await tick();
    const results = f.sent.filter((m) => m.type === "result" || m.type === "error").map((m) => m.id);
    expect(results).toContain(2);
  });
});
