import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  type SynthesisRequest,
  type SynthesisResult,
  type VoiceProfile,
  type AdamError,
  type Result,
  ok,
  err,
  adamError,
  PORTS,
  TIMEOUTS,
  createLogger,
} from "@adam/shared";

const logger = createLogger("voice:sidecar");

/**
 * VoiceClient manages the Python LuxTTS sidecar process.
 * The sidecar is a FastAPI server that wraps LuxTTS inference.
 * Adam spawns it on startup (if voice is enabled) and kills it on shutdown.
 *
 * Communication: HTTP POST /synthesize → WAV stream
 * Port: 18799 (localhost only, never exposed)
 */
export class VoiceClient {
  private process: ChildProcess | null = null;
  private baseUrl: string;
  private ready = false;

  constructor(
    private sidecarDir: string,
    private pythonExecutable = "python",
  ) {
    this.baseUrl = `http://localhost:${PORTS.VOICE_SIDECAR}`;
  }

  async start(): Promise<Result<void, AdamError>> {
    if (this.ready) return ok(undefined);

    const mainPy = join(this.sidecarDir, "main.py");
    if (!existsSync(mainPy)) {
      return err(
        adamError(
          "voice:sidecar-missing",
          `LuxTTS sidecar not found at ${mainPy}. Run 'adam voice install' to set it up.`,
        ),
      );
    }

    logger.info("Starting LuxTTS sidecar");

    this.process = spawn(
      this.pythonExecutable,
      ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(PORTS.VOICE_SIDECAR)],
      {
        cwd: this.sidecarDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      },
    );

    this.process.stderr?.on("data", (data: Buffer) => {
      logger.debug(`[sidecar] ${data.toString().trim()}`);
    });

    this.process.on("exit", (code) => {
      logger.warn("LuxTTS sidecar exited", { code });
      this.ready = false;
      this.process = null;
    });

    return this.waitForReady();
  }

  stop(): void {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
      this.ready = false;
      logger.info("LuxTTS sidecar stopped");
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async synthesize(
    request: SynthesisRequest,
    profile: VoiceProfile,
  ): Promise<Result<SynthesisResult, AdamError>> {
    if (!this.ready) {
      return err(adamError("voice:not-ready", "LuxTTS sidecar is not running"));
    }

    try {
      const response = await fetch(`${this.baseUrl}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: request.text,
          reference_audio_path: profile.referenceAudioPath,
          params: {
            rms: profile.params.rms,
            t_shift: profile.params.tShift,
            num_steps: profile.params.numSteps,
            speed: profile.params.speed,
            return_smooth: profile.params.returnSmooth,
            ref_duration: profile.params.refDuration,
          },
          output_path: request.outputPath,
        }),
        signal: AbortSignal.timeout(TIMEOUTS.VOICE_SYNTHESIS_MS),
      });

      if (!response.ok) {
        const text = await response.text();
        return err(adamError("voice:synthesis-failed", `Sidecar error: ${text}`));
      }

      const result = (await response.json()) as {
        audio_path: string;
        duration_ms: number;
        sample_rate: number;
      };

      return ok({
        audioPath: result.audio_path,
        durationMs: result.duration_ms,
        sampleRate: result.sample_rate,
        generatedAt: new Date(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(adamError("voice:synthesis-error", msg, e));
    }
  }

  private async waitForReady(): Promise<Result<void, AdamError>> {
    const deadline = Date.now() + TIMEOUTS.VOICE_SIDECAR_STARTUP_MS;

    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${this.baseUrl}/ping`, {
          signal: AbortSignal.timeout(1000),
        });
        if (res.ok) {
          this.ready = true;
          logger.info("LuxTTS sidecar ready");
          return ok(undefined);
        }
      } catch {
        // still starting
      }
      await sleep(500);
    }

    return err(
      adamError(
        "voice:sidecar-timeout",
        `LuxTTS sidecar did not become ready within ${TIMEOUTS.VOICE_SIDECAR_STARTUP_MS}ms`,
      ),
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
