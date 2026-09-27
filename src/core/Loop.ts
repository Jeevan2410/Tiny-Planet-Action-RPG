/**
 * Frame timing. Keeps a raw delta (for UI, camera shake and VFX that should keep
 * moving during a hit-stop) separate from the scaled gameplay delta.
 */
export class Loop {
  /** Seconds of simulated gameplay time since the loop started. */
  elapsed = 0;
  /**
   * Global multiplier on gameplay delta — a hook for slow motion. Combat's
   * hit-stop is applied in `Game` instead, so that it can freeze the simulation
   * while camera shake and VFX keep running on the raw delta.
   */
  timeScale = 1;

  private last = 0;
  private started = false;

  /** Longest frame we are willing to simulate, so a tab-switch cannot teleport actors. */
  private static readonly MAX_FRAME = 1 / 15;

  begin(nowMs: number): { dt: number; rawDt: number } {
    if (!this.started) {
      this.started = true;
      this.last = nowMs;
      return { dt: 0, rawDt: 0 };
    }
    const rawDt = Math.min((nowMs - this.last) / 1000, Loop.MAX_FRAME);
    this.last = nowMs;
    const dt = rawDt * this.timeScale;
    this.elapsed += dt;
    return { dt, rawDt };
  }

  /** Call after a pause/blur so the next frame does not see a huge delta. */
  resync(nowMs: number): void {
    this.last = nowMs;
  }
}
