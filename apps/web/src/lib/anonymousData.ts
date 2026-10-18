import { watch } from "vue";
import router from "@/router";
import { privacySettings, settings } from "@/stores/settings";

type UsageEvent = "onboarding.complete" | "onboarding.skip" | "workspace.canvas" | "workspace.document";
type AgentOutcome = "success" | "failed" | "cancelled";
type CanvasSnapshot = { nodes: readonly { type?: string }[]; edgeCount: number };
let readCanvas: (() => CanvasSnapshot | undefined) | undefined;
let collector: { track: (event: UsageEvent) => void; startAgent: () => (outcome: AgentOutcome) => void } | undefined;

const anonymousData = {
  track(event: UsageEvent) {
    collector?.track(event);
  },
  startAgent() {
    return collector?.startAgent() ?? (() => {});
  },
  observeCanvas(read: () => CanvasSnapshot | undefined) {
    readCanvas = read;
    return () => {
      if (readCanvas === read) readCanvas = undefined;
    };
  },
};
export default anonymousData;

export function registerAnonymousData() {
  const sessionId = crypto.randomUUID();
  const sessionStartedAt = Date.now();
  let anonymousId = "";
  let collecting = false;
  let generation = 0;
  let sequence = 0;
  let measuredAt = performance.now();
  let lastActivity = -Infinity;
  let visible = document.visibilityState === "visible";
  let elapsed = 0;
  let visibleElapsed = 0;
  let activeElapsed = 0;
  let activitySamples = 0;
  const events: Record<string, number> = {};
  const agent = { started: 0, success: 0, failed: 0, cancelled: 0, durationMs: { success: 0, failed: 0, cancelled: 0 } };
  let interval: ReturnType<typeof setInterval> | undefined;
  let controller: AbortController | undefined;

  function accountTime() {
    const now = performance.now();
    if (collecting) {
      elapsed += now - measuredAt;
      if (visible) {
        visibleElapsed += now - measuredAt;
        // ACT: 交互后最多计入 60 秒活跃时间；不读取键值、坐标或输入内容。
        activeElapsed += Math.max(0, Math.min(now, lastActivity + 60_000) - measuredAt);
      }
    }
    measuredAt = now;
    return now;
  }

  function markActivity() {
    if (!collecting || !visible || performance.now() - lastActivity < 1000) return;
    lastActivity = accountTime();
    activitySamples++;
  }

  const currentCollector = {
    track(event: UsageEvent) {
      if (!collecting) return;
      events[event] = (events[event] ?? 0) + 1;
    },
    startAgent() {
      const enabled = collecting;
      const startedAt = performance.now();
      const startedGeneration = generation;
      let finished = false;
      if (enabled) {
        agent.started++;
        markActivity();
      }
      return (outcome: AgentOutcome) => {
        if (finished) return;
        finished = true;
        if (!enabled || !collecting || generation !== startedGeneration) return;
        agent[outcome]++;
        agent.durationMs[outcome] += Math.round(performance.now() - startedAt);
      };
    },
  };
  collector = currentCollector;

  function recordPage() {
    if (!collecting) return;
    const event = ({ "/hello": "page.hello", "/home": "page.home", "/workspace": "page.workspace" } as Record<string, string>)[
      router.currentRoute.value.path
    ];
    if (event) events[event] = (events[event] ?? 0) + 1;
  }

  function report() {}

  function stop() {
    accountTime();
    collecting = false;
    generation++;
    lastActivity = -Infinity;
    clearInterval(interval);
    controller?.abort();
  }

  const stopWatching = watch(
    () => privacySettings.value.dataCollectionEnabled,
    (enabled) => {
      if (!enabled) return stop();
      anonymousId = privacySettings.value.anonymousId;
      if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(anonymousId)) {
        anonymousId = crypto.randomUUID();
        settings.value.privacy = { ...privacySettings.value, anonymousId };
      }
      collecting = true;
      measuredAt = performance.now();
      visible = document.visibilityState === "visible";
      if (sequence === 0) recordPage();
      report();
      interval = setInterval(report, 60_000);
    },
    { immediate: true, flush: "sync" }
  );
  function updateVisibility() {
    accountTime();
    visible = document.visibilityState === "visible";
    if (!visible) {
      lastActivity = -Infinity;
      report();
    }
  }
  function pageHide() {
    accountTime();
    visible = false;
    lastActivity = -Infinity;
    report();
  }
  function onInteraction(event: Event) {
    if (event.isTrusted) markActivity();
  }
  const stopRouter = router.afterEach((to, from, failure) => {
    if (!failure && to.path !== from.path) recordPage();
  });
  document.addEventListener("visibilitychange", updateVisibility);
  window.addEventListener("pagehide", pageHide);
  window.addEventListener("pageshow", updateVisibility);
  for (const event of ["pointerdown", "keydown", "wheel"]) window.addEventListener(event, onInteraction, { passive: true, capture: true });

  return () => {
    stopWatching();
    stopRouter();
    stop();
    if (collector === currentCollector) collector = undefined;
    document.removeEventListener("visibilitychange", updateVisibility);
    window.removeEventListener("pagehide", pageHide);
    window.removeEventListener("pageshow", updateVisibility);
    for (const event of ["pointerdown", "keydown", "wheel"]) window.removeEventListener(event, onInteraction, true);
  };
}
