"use client";

import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";

export type PublicStrategy = {
  key: string;
  name: string;
  description: string;
  family: string;
  available: boolean;
};

export function StrategyMarquee({ strategies }: { strategies: PublicStrategy[] }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const setRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ offset: 0, target: 0, shift: 0, last: 0, width: 0 });
  const hoveringRef = useRef(false);
  const focusedRef = useRef(false);
  const dragging = useRef<{ x: number; original: number; id: number } | null>(null);

  const nudge = useCallback((direction: number) => {
    stateRef.current.target += 300 * direction;
  }, []);

  useEffect(() => {
    if (!strategies.length) return;
    const track = trackRef.current;
    const set = setRef.current;
    if (!track || !set) return;
    const state = stateRef.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    const resize = () => { state.width = set.getBoundingClientRect().width + 16; };
    const observer = new ResizeObserver(resize);
    observer.observe(set);
    resize();
    const tick = (now: number) => {
      const dt = state.last ? Math.min(64, now - state.last) : 16;
      state.last = now;
      const paused = hoveringRef.current || focusedRef.current || dragging.current !== null || document.hidden;
      if (!reducedMotion.matches && !paused) state.offset += dt * 0.023;
      // Navigation arrows and drag still work when automatic motion is reduced.
      state.shift += (state.target - state.shift) * (1 - Math.exp(-dt * 0.012));
      const width = state.width || 1;
      const pos = ((state.offset + state.shift) % width + width) % width;
      track.style.transform = "translate3d(" + (-width - pos) + "px,0,0)";
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [strategies.length]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragging.current = { x: event.clientX, original: stateRef.current.target, id: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current || dragging.current.id !== event.pointerId) return;
    stateRef.current.target = dragging.current.original - (event.clientX - dragging.current.x);
  };
  const onPointerEnd = () => { dragging.current = null; };

  if (!strategies.length) return null;
  const list = strategies.map((strategy, i) => <article className="landing-strategy-card" key={strategy.key}>
    <div className="landing-strategy-category"><span>{strategy.family.replaceAll("_", " ").toLowerCase()}</span><span className="landing-sparkle" aria-hidden="true">✦</span></div>
    <div className={"landing-strategy-emblem tone-" + (i % 5)} aria-hidden="true"><span>{String(i + 1).padStart(2, "0")}</span></div>
    <h3>{strategy.name}</h3>
    <p>{strategy.description || "An investment approach with a defined rule set."}</p>
    <div className="landing-strategy-bottom"><span>Available for UK ISA</span><span aria-hidden="true">↗</span></div>
  </article>);
  return <section className="landing-strategies" id="strategies">
    <div className="landing-wrap landing-carousel-top">
      <div><div className="landing-kicker">Explore the methods</div><h2>Established ideas.<br/>Clear rules.</h2>
        <p>Only published, enabled strategies with verified UK ISA instruments appear here. Unavailable or unfinished strategies are never advertised as ready to use.</p></div>
      <div className="landing-arrows">
        <button type="button" aria-label="Previous strategies" onClick={() => nudge(-1)}>←</button>
        <button type="button" aria-label="Next strategies" onClick={() => nudge(1)}>→</button>
      </div>
    </div>
    <div className="landing-marquee-window" role="region" tabIndex={0}
      aria-label="Available strategy carousel. Use arrow keys or swipe to explore."
      onMouseEnter={() => { hoveringRef.current = true; }}
      onMouseLeave={() => { hoveringRef.current = false; }}
      onFocus={() => { focusedRef.current = true; }}
      onBlur={() => { focusedRef.current = false; }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
      onKeyDown={event => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault(); nudge(event.key === "ArrowLeft" ? -1 : 1);
        }
      }}>
      <div className="landing-marquee-track" ref={trackRef}>
        <div className="landing-marquee-set" aria-hidden="true">{list}</div>
        <div className="landing-marquee-set" ref={setRef}>{list}</div>
        <div className="landing-marquee-set" aria-hidden="true">{list}</div>
      </div>
    </div>
    <div className="landing-wrap landing-marquee-foot">
      <span>Swipe, hover to pause or use the arrows · Automatically pauses when motion is reduced</span>
      <Link href="/strategies">Understand the strategy types →</Link>
    </div>
  </section>;
}
