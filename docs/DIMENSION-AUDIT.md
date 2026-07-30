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
| 13 | Weld has "projecting wings in the **middle third**" | corrected | Backwards. Weld is a dumbbell: narrow ends, two projecting wing zones, and a **narrow waist** in the middle. The middle is the thinnest part at 41–48 ft, not the widest. Three independent footprints agree. | `weld.json` note, audit §2, chat |
| 14 | Ceiling height 10 ft 6 in | now sourced | Was fabricated as "typical for the period". Cambridge GIS gives eave 60.0 ft over 5 floors = **12 ft floor-to-floor**, which puts the ceiling at 10.5–11 ft. The guess was lucky; it now has a basis. | `IMPLEMENTATION-PLAN.md`, ledger |

Pattern worth naming: **five of the twelve are cases of me treating my own inference as a source.**
That is the failure mode to design against, not carelessness with arithmetic.

---

## 0. The primary source: a published specification from 1875

*The Harvard Book*, Vaille & Clark eds., 1875, vol. 1, pp. 135–136. Published three years after
completion. Verified against the original page scans, not OCR.
https://archive.org/details/harvardbookserie01vail

> "Its extreme dimensions are **one hundred and forty-three feet by fifty-one feet** in plan, and it
> contains **fifty-four studies, averaging sixteen feet by seventeen feet** each; of these,
> **twenty-two studies are connected with single bedrooms, seven feet by thirteen feet**, and the rest
> communicate each with a large double bedroom or two single bedrooms."

> "The building has **two central staircase halls, fifteen feet by thirty-one feet**, lighted and
> ventilated each by a lantern or louvre which rises above the roof."

> "The main entrance, which is **on the west front**, is by two wide arches opening on a large porch or
> loggia, **twenty-one feet by twenty-five feet**, paved with marble tiles."

> "A large double lift for coal, etc., is provided in a **closet opening from each staircase hall on
> every story**; this closet also contains a large public sink."

> "All the studies, excepting the **sixteen in the central part of the building**, and all the double
> bedrooms, are provided with **windows looking in two directions**, and **no rooms receive an
> exclusively north light.**"

Corroborated independently by *The Harvard Register* vol. III no. 3, March 1881, pp. 142–143, which
adds "**From each hall open twenty-seven studies**" — confirming 54 studies split evenly between two
stair halls — and repeats the same porch, stair-hall and bedroom dimensions.

### Why this is the most valuable source in the project

**143 × 51 ft in 1875 against my corrected 143.3 × 52 ft from five modern GIS datasets.** A primary
source and five independent modern surveys agree to within a foot, and both say my original 54 × 151
was wrong on both numbers.

### The constraint that most affects the layout

**"No rooms receive an exclusively north light."** A band of rooms across the north gable, all facing
north, would violate the building's own stated design principle. Rooms at the ends were designed as
corner rooms with two-directional light. Post-1962 and post-1992 partitions could have overridden
this, but as a prior it argues against the arrangement I had drawn.

### What the original module was

An original suite is **one study (16 × 17) plus bedrooms** — either a 7 × 13 single, a large double,
or two singles. Your suite has **two common rooms and two bedrooms**, which looks like **two original
suites merged**, each contributing its study. That would make K the second study. It is consistent
with Harvard recording two common rooms, and with the separate finding that no Weld suite has a
kitchen.

Also useful for the model's exterior: brick with light sandstone belts, slate roof (MACRIS CAM.184),
two gabled projections on the west and two opposite on the east each with an oriel, and a skyline
broken by the two staircase towers and clustered chimney shafts.

---

## 0b. Room numbering — solved

*The Harvard Crimson*, "12 Yard Dorms House '55", 12 September 1951, states the pre-1962 scheme
outright:

> "For seven of the freshman halls, the room numbers have nothing to do with the floor on which the
> suite is located… **Weld (five floors)--South entry, 12 to 27; North, 33 to 55. The first two floors
> of Weld South are offices, as is the first floor of Weld North.**"

So pre-1962 Weld had **two vertical entries with one continuous 1–55 sequence**, floor-independent.
Confirmed empirically: Crimson freshman directories from 1889–1933 yield a continuous run of Weld
room numbers including 10, 20, 30, 40 and 50, which is impossible under any floor-digit scheme.

That puts JFK's Weld 32 in the north entry's first floor, independently reproducing the 1983 article,
and **dissolves the tension I raised**: old "32" was never entryway 3, so no entryway boundary had to
be redrawn for 32 to become 15. The suite never moved; only the scheme changed.

**Post-1962**, every documented number is two digits with first digit 1–4 and second ≤5 (15, 24, 25,
45), 15 is documented as first floor, x4 reads "South" and x5 reads "North" on the same floor, and
Harvard's portal assigns Weld 15 to entryway "Weld 1". Best-supported model: **first digit = floor =
entryway; second digit runs south to north along the corridor. Weld 15 is the fifth suite on the
first floor, in the north half.** Not stated by any source, but tightly constrained.

Corroborating: a resident on Reddit — "Weld 1 is the first floor plus two suites on the second
floor." And Harvard's DSO states plainly that "**floor plans and room dimensions are not provided to
students**", which is why the resident's email exists at all.

### Renovation history, which governs which plan is authoritative

| Year | What happened | Source |
|---|---|---|
| 1871–72 | Built. Two stair halls, entryway plan, 54 studies. | 1875 Harvard Book |
| 1899, 1915, 1925, 1944 | Successive renovations; drawings catalogued | PIRC |
| **1962** | **Gut remodel of all five floors.** New suite partitions, new toilet rooms, stair hall replaced, common room built. Capacity 71 → 118. Rooms "completely renumbered". | Crimson 7 Feb & 26 Oct 1962; PIRC 1962-010 sheet titles incl. "Typical suite plans and elevations" |
| **1992–93** | **Second gut renovation.** North stair, south stair + new hydraulic elevator, east entrance made accessible, first Yard dorm fully accessible. Capacity 150. | Crimson 10 Nov 1992; PIRC HRE 1991-003, 67–109 sheets |

**Consequence:** the 1899 plans describe a building twice gutted since. Only the 1962 and 1992–93 sets
describe today's partitions, and both are access-restricted.

### A claim I revived too quickly, and am withdrawing again

After a student blog said "the elevator shaft on the first floor takes the place of where President
John F. Kennedy lived as a freshman," I said my retracted "elevator shaft" guess now had support.
**Wrong, and I should not have revived it.** The 1992–93 drawing titles put the elevator in the
**south** stair core; the 1992 Crimson puts the new elevator at the **east** entrance; the DSO calls
it "a central elevator". JFK's room was first floor **north**. The blog line is most likely campus
folklore. The leftover strip returns to genuinely unknown.

---

## 2a. Building geometry — five independent footprints

Superseding the two-source comparison below. All measured by rotating into the building frame.

| Source | Area sq ft | Length | Max width | Gable ends | Axis |
|---|---|---|---|---|---|
| Harvard ArcGIS Facilities3D (mine) | 7,780 | 142.9 | 62.3 | 51.8 | 13.2° |
| **Cambridge GIS BASEMAP_Buildings** | **7,869** | **143.8** | **63.0** | **52.9 / 53.5** | **12.82°** |
| MassGIS Building Structures (2-D) | 7,680 | 143.2 | 59.1 | 51.3 / 53.5 | 12.87° |
| OpenStreetMap way 29824449 | 8,117 | 144.9 | 64.1 | 52.3 / 53.8 | 12.00° |
| Microsoft GlobalMLBuildingFootprints | 7,741 | 141.5 | 59.4 | — | 9.23° |
| **independent mean** | **7,852** | **143.3** | **61.4** | **52.2** | — |

Every figure of mine lands within 1.5% of the independent mean. **Anchor on Cambridge GIS** — 52
vertices, highest fidelity, and it is the polygon the energy-disclosure data attaches to. MassGIS is
a 2011 *roofprint* from satellite ortho, which on a steep Victorian gable can miss the wall line;
Microsoft's is ML-derived with 8 vertices and a bearing 3–4° off everyone else.

**151 ft is confirmed as a rotation artifact.** Every source reproduces ~151 ft as the north-up
bounding box (mean 150.6) while true length is 141.5–144.9. Two clean checks: summing OSM's long
side-wall edges gives 142.7 and 144.1 ft; MassGIS's rectilinear polygon gives 143.21 ft.

### Weld's real shape, and another error of mine

I described "projecting wings in the middle third." **Wrong, and backwards.** All three
high-fidelity sources agree Weld is a dumbbell: narrow ends, two projecting wing zones, and a
**narrower waist** in the middle.

| Station along the axis | MassGIS | Cambridge | OSM |
|---|---|---|---|
| 0–23 ft, south end | 53.5 | 53.5 | 54.0 |
| 23–52 ft, south wings | 59.1 | 63.0 | 64.1 |
| 52–90 ft, **waist** | 47.3 | 41.4–47.8 | ~50 |
| 90–120 ft, north wings | 58.7 | 62.3 | 61.7 |
| **120–143 ft, north end** | **51.3** | **52.9** | **52.5** |

Two things this buys:

1. **The north end zone runs from 120 to 143 ft — 23 ft deep, 51–53 ft wide.** Measured
   independently three ways, and it is exactly the pocket the suite band has to sit in. The 20 ft
   band depth still fits with a few feet to spare.
2. **The two ends genuinely differ by 1–2 ft, and the north end is the narrower one.** Our suite is
   at the north end, so the governing width is 51.3–52.9 ft, not the 53.5 ft south figure.

### Floors, height and gross area — all newly sourced

| Quantity | Value | Source |
|---|---|---|
| Gross floor area | **43,118 sq ft** | Cambridge BEUDO energy disclosure, stable across 2015–2024, spatially joined to the polygon |
| Living area | 39,512 sq ft | Cambridge assessor (building match is inference, not a label) |
| Floors | **5** above grade plus basement | GFA / footprint = 5.48; living area / footprint = 5.02; Harvard's own guide says the elevator runs basement to fifth |
| Eave height | **60.0 ft** | Cambridge GIS |
| Ridge height | **85.4 ft** | Cambridge GIS — agrees with Harvard's 87.01 to 1.6 ft |
| **Floor-to-floor** | **12.0 ft** | 60 ft eave / 5 floors |

**This grounds the ceiling height, which was previously fabricated.** At 12 ft floor-to-floor, less
a period floor assembly of 12–18 in, the ceiling lands at **10.5–11 ft**. My inferred 10 ft 6 in was
a lucky guess; it now has a basis.

Sanity check on suite size: 43,118 GFA across roughly 30 modern suites is about 1,400 sq ft gross
each, so an 898 sq ft net suite is comfortably plausible. The 1872 configuration of 53 suites works
out to 814 sq ft gross per suite, but that was singles and doubles, not four-person suites with two
common rooms.

---

## 2. Building geometry — the original two-source check

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

### Settled: what is in the 5.2 ft outside the common room

Not a contradiction any more, but it was one, and the resolution is worth keeping because the losing
argument was mine.

Weld is a dumbbell — about 62 ft across the two wing zones, about 52 ft at the gable ends. The
suite's 44 ft section runs from building v 26.15 to 70.15 and therefore **crosses the step at
v 48.45**. The bedrooms, bathroom and unknown strip sit in the narrow end zone, where the suite's
facade line misses the ring's real wall by 0.19 ft. The common room and K sit in the wide zone, where
it misses by **5.36 ft**. Measured by `facadeStep()` in `place.ts`: the projection is 5.165 ft on the
east facade and 5.298 ft on the west.

So something occupies a 5.2 × 22 ft slab of Weld on the far side of the common room's window wall.
**It is masonry and a chimney breast, not floor.** Three reasons:

1. the resident gives the common room as 15 × 15–20 ft. The straight facade already puts it at the top of
   that range, 20 ft deep. Stepping the facade takes it to 25.17 ft and 377 sq ft, which contradicts
   the only dimension given for that room. Nothing else in this project overrides a GIVEN figure on
   the strength of a DERIVED one.
2. MACRIS CAM.184 describes the skyline as broken by the staircase towers **and clustered chimney
   shafts**, and the two roof features measured off `weld.rings[1]` and `[2]` sit at building
   v +40.2 and −37.8 — inside the two wing zones. A masonry projection with a stack rising directly
   above it explains the wall bulge and the roof lumps with one mechanism and contradicts no source.
   The measured asymmetry supports it: 5.165 ft against 5.298 ft is what a survey of masonry looks
   like, not a room somebody set out.
3. **The argument that first pointed the other way does not survive testing, and it was mine.** It
   ran: measured inward from each zone's own wall, a 20 ft common room reaches u 10.6 and a 16 ft
   bedroom reaches u 9.4, nearly the same line — so the inner wall is straight and the facade steps.
   But holding the depth at 20 and shifting the room bodily outward, which is what that argument
   predicts, detaches the common room from K: `unreachableRooms()` returns `["k"]`. Measured, not
   assumed. The variant that does close instead *grows* the room to 25.17 ft, which is reason 1.

`params.wingStep` implements the stepped reading and is **off**, and off is the claim rather than a
default. It is kept rather than deleted because the measurement behind it is real and worth keeping
addressable: if a 1962 or 1992 floor plan ever turns up showing a deeper common room, this is one
flag rather than a rebuild. It is not offered as a UI control, because it is not an open question.
Renders of both readings are in `design/renders/wing-common-straight.png` and
`wing-common-stepped.png`.

Two things the stepped mode does NOT do, recorded so nobody mistakes it for finished: `walls.ts`
still lays the facade masonry straight, so with the step on the new floor has no outer wall and no
ceiling; and bedroom A straddles v 48.45 with 6.80 ft in the wing zone and 3.20 ft in the end zone,
so a faithful stepped bedroom A has an L-shaped outer wall that a `Rect` cannot hold. It is left
straight rather than half-stepped.

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
