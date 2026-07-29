# Dimension audit

Every number this project rests on, where it came from, and whether it survived checking. Written
because I made a series of dimension errors that propagated into the drawings, the data files and
the code, and the only way to stop that is to reconcile the sources once, in one place.

Status vocabulary:

- **verified** — two or more independent sources agree, or it is analytically derivable
- **single-source** — one source, plausible, unconfirmed
- **corrected** — I published a wrong value; the right one is here
- **withdrawn** — a claim I made that turned out to be unsupported or circular
- **fabricated** — a number I invented and presented as though sourced. The worst category.
- **open** — unknown, being researched

---

## 1. Errors I made, and how far each one travelled

| # | Claim | Status | What was actually true | Where it spread |
|---|---|---|---|---|
| 1 | Weld is **54 ft** wide | corrected | **52 ft at the gable ends**, 62–64 ft across the wings. I measured one facade edge from OpenStreetMap and treated it as the building's cross-section. | `weld.json`, both artifacts, the plan drawing, the "51 ft clear width" derivation, `IMPLEMENTATION-PLAN.md` |
| 2 | Weld is **151 ft** long | corrected | **143–145 ft.** 151 was the axis-aligned bounding box in a north-up frame, inflated by the building's 13° rotation. It is not a building dimension at all. | same as above, plus every artifact footer |
| 3 | "The chain sums to 51 ft and Weld's clear width is 51 ft — **it fits**" | withdrawn | Circular. The leftover strip is *defined* as whatever remains, so closure is an identity, not evidence. It also depended on error #1, and on a bedroom rotation the client corrected. I called it "the strongest evidence the arrangement is right." It was not evidence. | the derivation artifact, prominently |
| 4 | Bathroom **8 × 16 ft, 128 sq ft** | fabricated | the resident's email gives **no bathroom dimension**. I rendered an invented number in the same typographic style as the sourced ones, on a page whose entire claim was provenance. | derivation artifact rev 1 |
| 5 | "**K has no window**" | fabricated | Never stated by anyone. I then used it to constrain where K could sit, so an invention became a load-bearing constraint. | rev 1–2 layout reasoning |
| 6 | The leftover strip is an **elevator shaft** | fabricated | Weld does have an elevator (basement→5, sourced). Its location is unknown. I labelled a guess as a fact on a drawing. | plan drawing rev 2 |
| 7 | The suite gets "**almost no direct sunlight**" | corrected | The gable faces azimuth 13.2°; a wall is lit within ±90° of its normal. It catches raking direct sun early morning and late evening from roughly **late February to late October**, and none in winter. | `IMPLEMENTATION-PLAN.md`, chat |
| 8 | Common room on the **left** on entry | corrected | On the right. Client caught it. | derivation rev 1 |
| 9 | Bedroom B is **16 × 10**, rotated to cap the hall | corrected | 10 × 16, same orientation as A. Client caught it. Removed a 96 sq ft phantom region my rotation had created. | derivation rev 1 |
| 10 | Suite area | corrected ×3 | 1,108 → 966 → 898 sq ft as the above were fixed. Now pending the width correction. | everywhere |
| 11 | **39** campus buildings | corrected | 36. Three were degenerate ArcGIS slivers of 0.045, 1.0 and 4.7 sq ft. | `campus.json`, tests |
| 12 | e2e "renders correctly" assertions | corrected ×2 | Version 1 asserted a WebGL context existed — true of a totally broken scene. Version 2 counted non-background pixels — satisfied by the grid helper alone, and it passed with the cube deleted. | `tests/e2e/smoke.spec.ts` |

Pattern worth naming: **five of the twelve are cases of me treating my own inference as a source.**
That is the failure mode to design against, not carelessness with arithmetic.

---

## 2. Building geometry — now cross-checked

Measured by rotating each dataset's ring into the building frame and slicing it, rather than reading
an axis-aligned bounding box.

| Quantity | OSM way 29824449 | Harvard Facilities3D | Status |
|---|---|---|---|
| Width at gable ends | 52.3 ft | 51.8 ft | **verified**, agree to 0.5 ft |
| Width across wings | 64.1 ft | 62.3 ft | **verified**, agree to 1.8 ft |
| Length along axis | 145.2 ft | 142.9 ft | **verified**, agree to 2.3 ft |
| Depth of the narrow end zone | ~24 ft | ~23 ft | **verified**, agree to 1 ft |
| Long axis, east of north | 12.0° | 13.15° | **verified**, agree to 1.2° |
| Footprint area | 8,122 sq ft | 7,780 sq ft | **verified** within 4% |
| Height | — | 87.01 ft | **single-source** |

Two independent digitisations, one by Harvard's own planning office and one by OSM contributors,
produced these within a couple of feet of each other. The gable-end width — the number that governs
the suite — agrees to six inches.

**Working values:** gable end **52 ft** exterior, wings **63 ft**, length **144 ft**, axis **13°**,
narrow end zone **23 ft** deep.

Clear width inside the gable end, less two 1.5 ft masonry walls: **49 ft**.

### The one real piece of corroboration

The narrow end zone is 23–24 ft deep in both datasets. The band depth of 20 ft was derived by a
completely separate route — the upper bound of the resident's "15 to 20 ft" uncertainty on the common room.
A 20 ft band fits inside a 23 ft zone with a few feet to spare, and would not fit if the zone were
the 15 ft lower bound. Those two agreeing is genuine evidence. Unlike the closure argument, neither
input knows about the other.

---

## 3. Harvard's official housing assignment — the best source we have

Supplied by the client from the Harvard housing portal. This is authoritative, first-party, and
current, which makes it the highest-quality source in the project. Verbatim:

```
Your space
  [verbatim housing record omitted]
  [verbatim housing record omitted]
  [verbatim housing record omitted]
  [verbatim housing record omitted]

Your residential community
  [verbatim housing record omitted]
  [verbatim housing record omitted]
  [verbatim housing record omitted]
  [verbatim housing record omitted]
```

### What this settles

| Question | Resolution | Effect |
|---|---|---|
| What is "K"? | **The second common room.** Harvard records two common rooms; the resident described one big rectangle plus a room marked K he could not identify. K is that second common room. | The single largest open question in the project, closed. No longer "kitchen vs study vs storage". |
| Is the room inventory complete? | **Yes.** Two bedrooms + two common rooms + one ensuite bath is exactly the five rooms the resident described. | Nothing is missing from his account, which raises confidence in the whole description. |
| Bedroom count | **2**, confirmed independently of the resident | verified |
| Bathroom | **Ensuite**, confirmed independently of the resident | verified |
| Entryway | **Weld 1** | Weld's entryways are numbered, not lettered. Suggests the first digit of a room number is the entryway: 15 = entryway 1, room 5. Would also explain "Weld South 24" and JFK's "Weld 32". |

### What it invalidates

The **7 × 7 ft unknown region behind the bathroom** is now doubtful. If the suite contains exactly
five rooms and no more, that space is either part of one of the five or outside the suite entirely.
It cannot be an unlisted sixth space. The client had already told me to stop assigning it to a room;
this says it should probably not be inside the suite boundary at all.

### Occupancy — settled

**Four people in two bedrooms: two doubles.** Confirmed by the client from the housing assignment,
which names three roommates alongside him. This overrides the inference pressure from Weld's
documented "quints and sextuplets" and from the seven students recorded in this suite in 1983 —
whatever was true in 1983, the 2026-27 assignment for this suite is four.

Consequences for the model: two beds, two desks, two dressers per bedroom; both common rooms stay
common rather than doubling as sleeping space. 160 sq ft per bedroom for two people, with roughly
420 sq ft of common space on top, makes this a genuinely good draw.

### What it does not settle
- One ambiguity to flag honestly: Harvard's own dorm data says the **Weld building** has two common
  rooms. That the suite figure is also two could in principle be a coincidence of the same number
  appearing at two scales. But the heading is "Your space" and the bedroom count beside it is
  unambiguously suite-level, so suite-level is the right reading.

---

## 4. The room program — one source, explicitly approximate

Everything below comes from a single email from the housing office dated 29 July 2026,
read off a blueprint the sender described as 31 years old, with the caveat that dimensions "could be
off by about a foot."

Provenance detail worth being precise about: the email opens "Hi [suitemate]", so it was written to one
of the three roommates and forwarded, not written to the client. That adds no uncertainty to the
numbers themselves, but the source is second-hand by one step and should be described that way.

| Room | Stated | Status |
|---|---|---|
| Common room | 15 × 15–20 ft | single-source. The range is the tell: it is the band depth he could not read off the plan. |
| Bedroom A, first door | "about 10 ft by 16 ft" | single-source |
| Bedroom B, third door | "about 16 ft by 10 ft" | single-source, read as 10 × 16 per the client |
| Room K | "roughly 10 ft by 12 ft" | single-source for the size. Purpose now **resolved**: Harvard records the suite as having two common rooms, so K is the second common room. |
| Bathroom | **no dimension given** | **open** |
| Hall width | not stated | **open** |
| Ceiling height | not stated | **open** |
| Closets | not mentioned | **open** |

Topology, which is firmer than the dimensions because it is described rather than measured:

- entry opens into a hallway, not a room
- common room immediately right on entry
- hallway to the left, with three doors along it
- door order: bedroom, bathroom, bedroom
- the third door is "at the end of the hall"
- K is "attached to the common room"

---

## 5. Building context — sourced

| Fact | Source | Status |
|---|---|---|
| Built 1871–72, architects Ware & Van Brunt | Harvard Planning; multiple | verified |
| 3 Harvard Yard, facility CA-03374, number 956 | Harvard ArcGIS | verified |
| Originally 53 suites, 22 single and the rest double | historical accounts | single-source |
| Five entryways, ~30 students each | Harvard first-year dorm layer | single-source |
| Elevator, basement to 5th floor | Harvard dorm layer; Crimson | verified |
| Two common rooms, each with a galley kitchen | Harvard dorm layer | single-source |
| Observatory at the top of the south tower | Harvard dorm layer | single-source |
| Tower clerestory stairs enclosed for fire in 1962 | architectural history | single-source |
| Laundry and Yard Operations on the garden level | Harvard dorm layer | single-source |
| Described as "quints and sextuplets", mixed in-suite and hallway baths | CampusReel, myDORM | single-source, **conflicts with a 4-person reading** |
| Weld 15 is on the first floor, north side | Crimson, 22 Nov 1983 | single-source |
| Weld 15 is JFK's freshman room, old Weld 32, renumbered in 1962 | Crimson, 22 Nov 1983 | single-source |
| "Weld 15 North" housed seven undergraduates in 1983 | Crimson, 22 Nov 1983 | single-source, **conflicts with a 4-person reading** |
| Weld uses North/South designations, e.g. "Weld South 24" | Crimson, 22 Nov 1983 | single-source |

---

## 6. Live contradictions

1. **Occupancy.** Weld is documented as quints and sextuplets; Weld 15 held seven in 1983; the
   client says four. Harvard's assignment confirms two bedrooms but gives no headcount. Note that K
   being a common room rather than a bedroom makes a 5-6 person suite tighter, not easier: five or six
   students would have to fit in two bedrooms. That pushes toward four, or toward students using a
   common room as a bedroom, which is common practice.
2. **Circulation type.** Harvard Yard dorms are traditionally entryway-plan, with suites off stair
   landings and no long corridors. But Weld has five entryways *and* an elevator *and* a source
   describing "open hallways" that make it "feel airy." Entryway-plan and corridor-plan imply
   different suite shapes. The 1962 renovation may have converted it.
3. **The 3 ft the rooms overshoot by.** Room columns need 51 ft of the 49 ft available. Absorbing it
   into the strip that "isn't ours" is the cheapest fix and touches none of the resident's numbers, but it
   leaves that strip about 3 ft wide — too thin for a stair, about right for a plumbing chase. The
   alternative is that one stated width is a foot or two smaller than reported, which his own ±1 ft
   caveat permits.
4. **Which end is the common room.** Undetermined. Depends on which wall the suite door is in.

---

## 7. Being researched

Six parallel searches are out on: original architectural drawings (HABS, MACRIS, National Register,
Harvard Archives, Ware & Van Brunt collections); Harvard institutional documents that leak plans
(fire egress diagrams, capital project filings, accessibility surveys, Cambridge permits);
first-hand student descriptions of Weld suites; independent footprint verification (MassGIS,
Cambridge assessor, Microsoft footprints); Weld's room-numbering scheme and what the 1962
renovation actually changed; and floor plans for comparable 1870s Harvard Yard dormitories as
indirect evidence of plan type.

No layout is being finalised and no further application code is being written until those come back.

---

## 8. What the closed inventory forces

With the room list closed at five and the clear width verified at 49 ft, the bathroom width is the
only free variable across the band. Solving for it:

```
bedroom B 10 + bath ? + bedroom A 10 + common room 15 + 3 partitions 1.5 + leftover = 49 ft

  bath 6 ft  ->  51 sq ft bath, 6.5 ft leftover
  bath 7 ft  ->  60 sq ft bath, 5.5 ft leftover
  bath 8 ft  ->  68 sq ft bath, 4.5 ft leftover
  bath 12.5  -> 106 sq ft bath, 0.0 ft leftover
```

**The band cannot close with a plausible bathroom.** Forcing zero leftover demands a 106 sq ft
bathroom, which no four-person dorm suite has. A credible bath of 6 to 8 ft leaves 4.5 to 6.5 ft
over.

So the conclusion the evidence actually supports: **the suite occupies roughly 43 to 45 ft of the
49 ft clear width, and 4.5 to 6.5 ft at one end belongs to the building** — a riser chase, a service
closet, or the corridor turning the corner. That strip is not ours and is not a room, which is
consistent with Harvard listing exactly five rooms.

This is the opposite of the earlier reasoning, and better. Before, I forced closure and called it
evidence. Now closure is refused, and the refusal is itself informative: it puts a bound on the
bathroom and tells us the suite does not span the full width.

### Working layout, pending the research

| Room | Size | Area | Basis |
|---|---|---|---|
| Common room 1 | 15 × 20 | 300 sq ft | given, depth from the range |
| Common room 2 (K) | 10 × 12 | 120 sq ft | given; identified as a common room by Harvard |
| Bedroom A | 10 × 16 | 160 sq ft | given |
| Bedroom B | 10 × 16 | 160 sq ft | given, per the client's reading |
| Bathroom | 7 × 8.5 | 60 sq ft | inferred, bounded 6–8 ft wide by the arithmetic above |
| Hall | 28 × 3.5 | 98 sq ft | derived |
| **Suite** | | **898 sq ft** | **224 sq ft per person for four** |

Four people, two doubles, roughly 420 sq ft of common space. This is a good draw.
