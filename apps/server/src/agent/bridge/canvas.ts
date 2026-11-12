import { canvasOperations } from "@toonflow/tool-canvas/runtime";
import type { CanvasInfo, CanvasContext } from "@toonflow/tools-scaffold/runtime";
import type { AgentEvent } from "@/agent/runtime/types";

type CanvasResult = { result?: unknown; error?: string };
type PendingCall = { cwd: string; started: boolean; start(): void; finish(response: CanvasResult): void; interrupt(error: Error): void };

// ACT: 回传仅在当前 Server 进程存活期间有效；多进程部署需共享请求通道。
const pendingCalls = new Map<string, PendingCall>();

export function createCanvasContext(cwd: string, canvas: CanvasInfo, send: (event: Extract<AgentEvent, { type: "canvasCall" }>) => void,
  onTransportFailure: (error: Error) => void) {
  const activeCalls = new Set<string>();
  let queue = Promise.resolve();
  let disposed = false;
  const context: CanvasContext = {
    ...canvas,
    async call(request, signal) {
      // 前端顺序执行画布变更；轮到当前调用再发送和计时，避免排队消耗执行超时。
      const pending = queue.then(() => {
        if (disposed) throw new Error("画布调用所属对话已结束");
        signal?.throwIfAborted();
        const operation = canvasOperations.find(item => item.name === request.name);
        if (!operation) throw new Error("画布操作不存在");
        const args = operation.parameters.parse(request.args);
        const callId = crypto.randomUUID();
        return new Promise((resolve, reject) => {
          const finish = ({ result, error }: CanvasResult) => {
            if (!pendingCalls.delete(callId)) return;
            activeCalls.delete(callId);
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            if (error !== undefined) reject(new Error(error || "画布调用失败"));
            else resolve(result);
          };
          const abort = () => finish({ error: "画布调用已取消" });
          const failTransport = (error: Error) => {
            finish({ error: error.message });
            onTransportFailure(error);
          };
          let timer = setTimeout(() => failTransport(new Error(`浏览器未接收画布调用 ${operation.name}，请重新打开画布后继续`)), 120_000);
          const call: PendingCall = {
            cwd, started: false, finish, interrupt: failTransport,
            start() {
              call.started = true;
              clearTimeout(timer);
              // 浏览器执行限时两分钟，额外留出结果回传时间。
              timer = setTimeout(() => failTransport(new Error(`画布调用 ${operation.name} 未回传结果，请核对画布和已有任务`)), 135_000);
            },
          };
          pendingCalls.set(callId, call);
          activeCalls.add(callId);
          signal?.addEventListener("abort", abort, { once: true });
          try { send({ type: "canvasCall", callId, name: operation.name, args }); }
          catch (error) { failTransport(error instanceof Error ? error : new Error("发送画布调用失败")); }
        });
      });
      queue = pending.then(() => {}, () => {});
      return pending;
    },
  };
  return {
    context,
    dispose() {
      disposed = true;
      for (const callId of activeCalls) pendingCalls.get(callId)?.finish({ error: "画布调用所属对话已结束" });
    },
  };
}

function requireCanvasCall(cwd: string, callId: string) {
  const pending = pendingCalls.get(callId);
  if (!pending || pending.cwd !== cwd) throw Object.assign(new Error("画布调用不存在或已结束"), { status: 404 });
  return pending;
}

export function startCanvasCall(cwd: string, callId: string) {
  const pending = requireCanvasCall(cwd, callId);
  if (pending.started) throw Object.assign(new Error("画布调用已被接收"), { status: 409 });
  pending.start();
}

export function finishCanvasCall(cwd: string, callId: string, response: CanvasResult) {
  const pending = requireCanvasCall(cwd, callId);
  if (!pending.started) throw Object.assign(new Error("画布调用尚未开始"), { status: 409 });
  pending.finish(response);
}

export function interruptCanvasCall(cwd: string, callId: string, reason: string) {
  requireCanvasCall(cwd, callId).interrupt(new Error(reason));
}
