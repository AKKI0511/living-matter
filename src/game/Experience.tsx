"use client";
import dynamic from "next/dynamic";
import { Component, useEffect, useState, type ReactNode } from "react";
import { useGame } from "./store";
import { clearInput, input } from "./input";
import { sound } from "./audio";

const Scene = dynamic(() => import("./Scene"), { ssr: false });
class SceneBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    useGame.getState().setPhase("error");
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function capturePointer() {
  if (matchMedia("(pointer: fine)").matches) {
    const promise = document.querySelector("canvas")?.requestPointerLock();
    promise?.catch(() => {
      /* Drag-to-look remains available when locking is restricted. */
    });
  }
}

export default function Experience() {
  const phase = useGame((s) => s.phase),
    muted = useGame((s) => s.muted),
    quality = useGame((s) => s.quality),
    run = useGame((s) => s.run);
  const [hint, setHint] = useState(true),
    [lock, setLock] = useState(false);
  useEffect(() => {
    useGame.setState({
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
    const keys = new Set<string>();
    const update = () => {
      input.forward =
        Number(keys.has("KeyW") || keys.has("ArrowUp")) -
        Number(keys.has("KeyS") || keys.has("ArrowDown"));
      input.right =
        Number(keys.has("KeyD") || keys.has("ArrowRight")) -
        Number(keys.has("KeyA") || keys.has("ArrowLeft"));
      input.jump = keys.has("Space");
      input.sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === "Escape" && useGame.getState().phase === "playing") {
        useGame.getState().setPhase("paused");
        document.exitPointerLock?.();
      }
      if (useGame.getState().phase !== "playing") return;
      if (e.code === "Space" && !e.repeat) input.jumpQueued = true;
      if (
        ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
          e.code,
        )
      )
        e.preventDefault();
      keys.add(e.code);
      update();
    };
    const up = (e: KeyboardEvent) => {
      keys.delete(e.code);
      update();
    };
    const mouse = (e: MouseEvent) => {
      if (
        useGame.getState().phase !== "playing" ||
        (!document.pointerLockElement && !input.dragging)
      )
        return;
      input.yaw -= e.movementX * 0.0018;
      input.pitch = Math.max(
        -1.35,
        Math.min(1.35, input.pitch - e.movementY * 0.0018),
      );
    };
    const changed = () => {
      setLock(!!document.pointerLockElement);
      if (
        !document.pointerLockElement &&
        useGame.getState().phase === "playing"
      )
        useGame.getState().setPhase("paused");
    };
    const blur = () => {
      keys.clear();
      clearInput();
      if (useGame.getState().phase === "playing")
        useGame.getState().setPhase("paused");
    };
    const visibility = () => {
      if (document.hidden) blur();
    };
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    addEventListener("mousemove", mouse);
    addEventListener("blur", blur);
    document.addEventListener("pointerlockchange", changed);
    document.addEventListener("visibilitychange", visibility);
    const unsubscribe = useGame.subscribe((state) => {
      if (state.phase !== "playing") {
        keys.clear();
        clearInput();
      }
      sound.pause(state.phase !== "playing");
    });
    return () => {
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
      removeEventListener("mousemove", mouse);
      removeEventListener("blur", blur);
      document.removeEventListener("pointerlockchange", changed);
      document.removeEventListener("visibilitychange", visibility);
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    sound.mute(muted);
  }, [muted]);
  useEffect(() => {
    setHint(true);
  }, [run]);
  useEffect(() => {
    if (phase !== "playing") return;
    const timer = setTimeout(() => setHint(false), 9000);
    return () => clearTimeout(timer);
  }, [phase, run]);
  const begin = () => {
    void sound.start().catch(() => {});
    useGame.getState().setPhase("playing");
    capturePointer();
  };
  const restart = () => {
    input.yaw = 0;
    input.pitch = -0.03;
    clearInput();
    sound.reset();
    useGame.getState().restart();
    capturePointer();
  };
  const panel = phase !== "playing";
  return (
    <main className={`experience phase-${phase}`}>
      <div
        className="world"
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && phase === "playing")
            input.dragging = true;
        }}
        onPointerUp={() => {
          input.dragging = false;
        }}
      >
        <SceneBoundary>
          <Scene />
        </SceneBoundary>
      </div>
      <div className="film" aria-hidden="true" />
      {panel && (
        <section
          className="overlay"
          aria-label={
            phase === "complete" ? "Journey complete" : "Living Matter"
          }
        >
          <div className="edition">
            <span className="mark" /> LIVING MATTER{" "}
            <span className="edition-detail">AN INTERACTIVE WORLD</span>
          </div>
          <div className="intro">
            <p className="eyebrow">
              {phase === "complete"
                ? "THE OTHER SIDE"
                : phase === "paused"
                  ? "A MOMENT OF STILLNESS"
                  : "A QUIET WORLD IN MOTION"}
            </p>
            <h1>
              {phase === "complete" ? (
                <>
                  You found
                  <br />
                  your way.
                </>
              ) : phase === "paused" ? (
                <>
                  Stay a<br />
                  little longer.
                </>
              ) : (
                <>
                  Nothing here
                  <br />
                  stays still.
                </>
              )}
            </h1>
            <p className="description">
              {phase === "complete"
                ? "The world moved with you."
                : phase === "paused"
                  ? "The light is still waiting."
                  : "Follow the light. The way will find you."}
            </p>
          </div>
          <div className="entry">
            {phase === "loading" ? (
              <p className="loading" role="status">
                <span /> Shaping the world
              </p>
            ) : phase === "error" ? (
              <>
                <p className="error-copy">
                  The world couldn’t open.
                  <br />
                  Try reloading in a browser with WebGL 2 enabled.
                </p>
                <button className="enter" onClick={() => location.reload()}>
                  Try again <span>↗</span>
                </button>
              </>
            ) : (
              <>
                <button
                  className="enter"
                  onClick={phase === "complete" ? restart : begin}
                >
                  {phase === "complete"
                    ? "Wander again"
                    : phase === "paused"
                      ? "Continue"
                      : "Enter the world"}{" "}
                  <span>↗</span>
                </button>
                <p className="controls desktop">
                  W A S D <span>move</span> &nbsp; MOUSE <span>look</span>{" "}
                  &nbsp; SPACE <span>jump</span>
                </p>
                <p className="controls touch-copy">
                  Left thumb to move · right thumb to look
                </p>
              </>
            )}
            {(phase === "paused" || phase === "complete") && (
              <div className="settings">
                <button onClick={() => useGame.getState().toggleMute()}>
                  Sound {muted ? "off" : "on"}
                </button>
                <button
                  onClick={() =>
                    useGame
                      .getState()
                      .setQuality(quality === "high" ? "low" : "high")
                  }
                >
                  Detail {quality}
                </button>
                {phase === "paused" && (
                  <button onClick={restart}>Start over</button>
                )}
              </div>
            )}
          </div>
          <div className="footer">
            <span>A SMALL JOURNEY, AT YOUR OWN PACE</span>
            <span>HEADPHONES RECOMMENDED</span>
          </div>
        </section>
      )}
      {phase === "playing" && (
        <>
          <button
            className="pause"
            aria-label="Pause"
            onClick={() => {
              useGame.getState().setPhase("paused");
              document.exitPointerLock?.();
            }}
          >
            Ⅱ
          </button>
          <div className={`hint ${hint ? "visible" : ""}`} aria-hidden={!hint}>
            <span className="desktop">
              WASD to move · {lock ? "mouse" : "drag"} to look · space to jump ·
              shift to run
            </span>
            <span className="touch-copy">Move toward the light</span>
          </div>
          <TouchControls />
        </>
      )}
      <noscript>
        <div className="noscript">
          Living Matter needs JavaScript and WebGL 2 to open the world.
        </div>
      </noscript>
    </main>
  );
}

function TouchControls() {
  const [origin, setOrigin] = useState<[number, number] | null>(null);
  const [look, setLook] = useState<[number, number] | null>(null);
  return (
    <div className="touch-controls">
      <div
        className="touch-move"
        aria-label="Movement joystick"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setOrigin([e.clientX, e.clientY]);
        }}
        onPointerMove={(e) => {
          if (!origin) return;
          input.right = Math.max(-1, Math.min(1, (e.clientX - origin[0]) / 45));
          input.forward = Math.max(
            -1,
            Math.min(1, (origin[1] - e.clientY) / 45),
          );
        }}
        onPointerUp={() => {
          setOrigin(null);
          input.forward = input.right = 0;
        }}
        onPointerCancel={() => {
          setOrigin(null);
          input.forward = input.right = 0;
        }}
      >
        <span />
      </div>
      <div
        className="touch-look"
        aria-label="Look around"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setLook([e.clientX, e.clientY]);
        }}
        onPointerMove={(e) => {
          if (!look) return;
          input.yaw -= (e.clientX - look[0]) * 0.004;
          input.pitch = Math.max(
            -1.3,
            Math.min(1.3, input.pitch - (e.clientY - look[1]) * 0.004),
          );
          setLook([e.clientX, e.clientY]);
        }}
        onPointerUp={() => setLook(null)}
        onPointerCancel={() => setLook(null)}
      />
      <button
        className="touch-jump"
        aria-label="Jump"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          input.jump = true;
          input.jumpQueued = true;
        }}
        onPointerUp={() => {
          input.jump = false;
        }}
        onPointerCancel={() => {
          input.jump = false;
        }}
      >
        ↑
      </button>
    </div>
  );
}
