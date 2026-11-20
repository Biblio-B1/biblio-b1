// Web Worker (module) d'exécution du code étudiant : moteurs WASM servis depuis /runtimes/.
import { attachWorkerProtocol, createBrowserEngine } from "@/lib/runners/browser";

attachWorkerProtocol(self as unknown as Parameters<typeof attachWorkerProtocol>[0], createBrowserEngine());
