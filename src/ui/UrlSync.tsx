"use client";

import { useEffect, useRef } from "react";
import { decode, encode, SNAPSHOT_PARAM, type Snapshot } from "@/state/url";
import { useStore } from "@/state/store";

/**
 * The link, wired: read once on boot, written back on every change.
 *
 * url.ts does the hard part -- the packing, the validation, the totality -- so this
 * component is only the two moments where that format meets the browser. Both are
 * narrow and both have a trap in them.
 *
 * BOOT IS ONCE, AND IT IS A REPLACE
 * Reading the parameter happens in a mount effect with an empty dependency list and a
 * ref that latches, so a link cannot be re-applied later: if it were re-read on any
 * subsequent render, the first slider move would be undone by the URL it just wrote,
 * which is a fight the user always loses. If decode() returns null the store is left
 * exactly as it was -- at its defaults -- and NOTHING is logged. A malformed link
 * opening quietly at the defaults is the specified behaviour (docs/phases/P6.md gate
 * 7), and a console error would fail that gate while looking like diligence.
 *
 * WRITING IS replaceState AND NOT pushState
 * A slider emits an event per pointer move. pushState would put every intermediate
 * value of a drag into the history stack, so Back would walk the user through a
 * hundred ceiling heights instead of leaving the page. replaceState keeps the address
 * bar current -- which is what makes the URL copyable at any moment -- without
 * touching history at all.
 *
 * WHAT IS NOT WATCHED, AND WHY THE LIST IS SHORT ON PURPOSE
 * The subscription is to the eight fields url.ts carries, individually, rather than to
 * the whole store. `reducedMotion` is deliberately absent: url.ts refuses to encode it
 * because it is the reader's own preference rather than shared state, so watching it
 * here would rewrite the URL on a media-query change for no reason. Not watched is not
 * the same as not observable: publish() below puts it on window.__weld regardless, and
 * that costs no write because publishing and writing are separate. `selected` and
 * `notice` are absent because they are about the current interaction, not the model --
 * a link that carried "this piece is selected" would reopen with somebody else's
 * cursor in it.
 */
export function UrlSync() {
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const q = new URLSearchParams(window.location.search).get(SNAPSHOT_PARAM);
    if (!q) return;
    const s = decode(q);
    // Silence is the specification here. See the header.
    if (!s) return;
    useStore.getState().hydrate(s);
  }, []);

  useEffect(() => {
    let lastQ = "";

    /**
     * The editable state, observable from outside.
     *
     * Same device as window.__cam and window.__perf, and for the same reason: the
     * model is a WebGL canvas, so a gate that wants to know whether a slider moved
     * a wall has no DOM to read.
     *
     * Published on EVERY store change and not only when the URL is rewritten, because
     * `notice` is a field a gate needs that is deliberately not carried by a link, so it
     * never triggers a write. `q` is whatever the last write produced, which is what
     * makes it comparable against the address bar rather than a second opinion about it.
     *
     * WHY `t` IS HERE, AND WHAT IT COSTS
     * It was left out on the suspicion that it changes every frame, which would make a
     * cheap publish into a per-frame one. It does not, and the suspicion is checkable
     * rather than a matter of taste: `setT` has exactly ONE caller in the app --
     * Hud.tsx's stage-4 threshold slider, from an onChange -- and the only other writes
     * to `t` are setStage, next, prev and skipToSuite putting it back to 0 or 1.
     * CameraRig reads it and never sets it, so no render loop advances it. The publish
     * rate is therefore bounded by input events, exactly as it already was for the
     * fifteen dimension sliders, and not by the frame rate.
     *
     * The cost was measured rather than reasoned about: the same literal at 8 fields and
     * at 11, over 2,000,000 constructions on a store-shaped object with the real 29
     * pieces and 17-field params behind it, came out at 6.9 / 7.3 / 6.9 ns against 8.8 /
     * 8.6 / 8.6 ns -- 1.4 to 1.9 ns per publish, three times alternating. Nothing is
     * copied at either width: `t` and `reducedMotion` are primitives and `orbit` is the
     * reference the store already holds.
     *
     * AND THE 150 ms DEBOUNCE IS UNTOUCHED, which is the other thing that could have
     * gone wrong. This function never schedules a write; `key()` below decides that, and
     * it already carried both `s.t` and `s.orbit` before either appeared here, so the
     * number of replaceState calls a threshold drag makes is exactly what it was.
     * `reducedMotion` is published and still deliberately absent from `key()` -- the
     * header says why -- so a media-query change now shows up to a gate without
     * rewriting the URL.
     */
    const publish = () => {
      const s = useStore.getState();
      (window as unknown as { __weld?: unknown }).__weld = {
        q: lastQ,
        stage: s.stage,
        t: s.t,
        params: s.params,
        cutaway: s.cutaway,
        occupancy: s.occupancy,
        pieces: s.pieces.length,
        notice: s.notice,
        orbit: s.orbit,
        reducedMotion: s.reducedMotion,
      };
    };

    /**
     * Rewrite the address bar from the store.
     *
     * encode() returns "" for a snapshot the format cannot carry, and that is not
     * treated as an error either: it means "not shareable", so the parameter is
     * dropped rather than replaced with something that would decode to a different
     * suite. Every state this app can reach through its own controls is encodable,
     * so "" is a belt on top of a brace, and what it costs when it fires is a link
     * that opens at the defaults instead of a link that lies.
     */
    const write = () => {
      const s = useStore.getState();
      const snap: Snapshot = {
        stage: s.stage,
        t: s.t,
        params: s.params,
        pieces: s.pieces,
        cutaway: s.cutaway,
        hour: s.hour,
        date: s.date,
        orbit: s.orbit,
        occupancy: s.occupancy,
      };
      const q = encode(snap);
      lastQ = q;
      publish();

      const url = new URL(window.location.href);
      if (q) url.searchParams.set(SNAPSHOT_PARAM, q);
      else url.searchParams.delete(SNAPSHOT_PARAM);
      // Only when it actually differs: replaceState on an unchanged URL is cheap but
      // not free, and this runs on the same events the sliders fire.
      if (url.toString() !== window.location.href) {
        window.history.replaceState(null, "", url);
      }
    };

    /**
     * The nine carried fields, by REFERENCE for the three that are objects.
     *
     * Not JSON.stringify of the tuple, which is the obvious way to write this and is
     * wrong here: an orbit drag writes the store on every frame, and stringifying 29
     * pieces sixty times a second to discover that none of them moved is real work
     * done to learn nothing. Every one of these is replaced rather than mutated when
     * it changes -- resetAll() hands back a fresh params object, the piece list is
     * rebuilt by map, setOrbit is handed a fresh object -- so reference identity is
     * exactly the right test, and it is one comparison per field.
     */
    const key = () => {
      const s = useStore.getState();
      // occupancy is HERE and not only in write(). It changes without changing any
      // other field -- setOccupancy deliberately does not re-fit, so moving the
      // slider and not pressing Refit leaves `pieces` identical -- so a key that
      // omitted it would carry the new occupancy in the snapshot and never schedule
      // the write that puts it in the address bar.
      return [
        s.stage,
        s.t,
        s.params,
        s.pieces,
        s.cutaway,
        s.hour,
        s.date,
        s.orbit,
        s.occupancy,
      ] as const;
    };
    let last = key();

    /**
     * Trailing debounce, because the events this rides on are continuous.
     *
     * A slider or an orbit drag emits per pointer move, and each write is an encode()
     * plus a replaceState. 150 ms is under the threshold at which the address bar
     * feels stale and well above a frame, so a drag costs one write at the end instead
     * of one per frame. The timer is cleared on unmount, so a component that goes away
     * mid-drag does not write afterwards.
     */
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(write, 150);
    };

    write();
    const stop = useStore.subscribe(() => {
      publish();
      const now = key();
      if (now.every((x, i) => x === last[i])) return;
      last = now;
      schedule();
    });
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, []);

  return null;
}
