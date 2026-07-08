import { spawn } from "node:child_process";
import path from "node:path";

const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const DATA_PIPELINE_DIR =
  process.env.DATA_PIPELINE_DIR || path.resolve(process.cwd(), "../data-pipeline");

// 같은 도시를 짧은 시간에 여러 번 요청해도 재계산은 스킵한다(외부 항공권/숙박 스크래핑은
// 비용/레이트리밋이 있는 호출이라 폭주를 막아야 함).
const UPDATE_COOLDOWN_MS = 10 * 60 * 1000;

// cityId -> { status: "running" | "done", updatedAt: number }
// 서버 프로세스 하나 안에서만 유효한 디바운스/락이라, 인스턴스를 여러 개 띄우면
// 이 상태는 인스턴스별로 따로 논다(지금 규모에서는 충분).
const cityUpdateState = new Map();

export function shouldSkip(cityId) {
  const state = cityUpdateState.get(cityId);
  if (!state) return false;
  if (state.status === "running") return true;
  return Date.now() - state.updatedAt < UPDATE_COOLDOWN_MS;
}

export function runCityBatch(cityId) {
  cityUpdateState.set(cityId, { status: "running", updatedAt: Date.now() });

  const child = spawn(PYTHON_BIN, ["main_batch.py", cityId], {
    cwd: DATA_PIPELINE_DIR,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => console.log(`[batch:${cityId}] ${chunk}`.trimEnd()));
  child.stderr.on("data", (chunk) => console.error(`[batch:${cityId}] ${chunk}`.trimEnd()));

  child.on("close", (code) => {
    cityUpdateState.set(cityId, { status: "done", updatedAt: Date.now() });
    if (code !== 0) {
      console.error(`[batch:${cityId}] main_batch.py 종료 코드 ${code}`);
    } else {
      console.log(`[batch:${cityId}] 갱신 완료`);
    }
  });

  child.on("error", (err) => {
    cityUpdateState.set(cityId, { status: "done", updatedAt: Date.now() });
    console.error(`[batch:${cityId}] 실행 실패`, err);
  });
}
