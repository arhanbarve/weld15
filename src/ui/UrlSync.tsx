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
 * here would rewrite the URL on a media-query change for no reason. `selected` and
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
    /**
     * Rewrite the address bar from the store.
     *
     * encode() returns "" for a snapshot the format cannot carry, and that is not
     * treated as an error either: it means "not shareable", so the parameter is
     * dropped rather than replaced with something that would decode to a different
     * suite. Every state this app can reach through its own controls is encodable --
     * setParams() refuses anything url.ts would refuse -- so "" is a belt on top of a
     * brace, and what it costs when it fires is a link that opens at the defaults
     * instead of a link that lies.
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
      };
      const q = encode(snap);
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
     * The eight carried fields, by REFERENCE for the three that are objects.
     *
     * Not JSON.stringify of the tuple, which is the obvious way to write this and is
     * wrong here: an orbit drag writes the store on every frame, and stringifying 29
     * pieces sixty times a second to discover that none of them moved is real work
     * done to learn nothing. Every one of these is replaced rather than mutated when
     * it changes -- setParams spreads, the piece list is rebuilt by map, setOrbit is
     * handed a fresh object -- so reference identity is exactly the right test, and it
     * is one comparison per field.
     */
    const key = () => {
      const s = useStore.getState();
      return [s.stage, s.t, s.params, s.pieces, s.cutaway, s.hour, s.date, s.orbit] as const;
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
