# Weld 15 — final layout decision

Conclusion of the research phase. Six parallel searches, five independent building footprints, a
primary published specification from 1875, Harvard's own housing assignment, and first-hand resident
accounts. This is the layout the model will be built from.

**Superseded:** every earlier drawing in `design/`. They had the suite's orientation wrong.

---

## 1. What is now established

### The envelope

| Quantity | Value | Basis |
|---|---|---|
| Building | **143 × 51 ft** | 1875 primary source; five modern GIS datasets agree within 1 ft |
| Long axis | 13° east of north | Harvard GIS, OSM, MassGIS, Cambridge GIS; brute-force sweep confirms |
| Floors | 5 above grade + basement | GFA/footprint 5.48; assessor 5 storeys; elevator basement→5 |
| Eaves / ridge | **60.0 / 85.4 ft** above grade | Cambridge GIS; 5 × 12 ft = 60 exactly |
| Floor-to-floor | **12 ft** → ceiling ~10.75 ft | eaves 60 / 5 floors |
| Gross floor area | 43,118 sq ft | Harvard GIS `gsf_caps` and Cambridge BEUDO, independently |
| Walls / roof | brick with light sandstone belts / slate | 1875 text; MACRIS CAM.184 |

### The plan module — the key structural finding

The 1875 dimensions decompose the building exactly along its length:

```
44 ft end section | 15 stair hall | 25 porch | 15 stair hall | 44 ft end section  = 143 ft
```

Cross-check on the depth: porch 21 ft deep + stair hall 31 ft deep = 52 ft against a quoted 51 ft
building depth, and the 1875 text says the stair halls "have also rear exits" — so each hall runs
from the west porch straight through to an east rear door.

**44 ft per end section** matches the recurring Harvard section width: Grays' wings 43 ft, Grays'
centre 42′8″, Hollis' middle section 42′0½″. Ware & Van Brunt reused the Old Yard module.

### Where Weld 15 is

First floor, north half. Fifth suite. Entryway "Weld 1" = the first floor plus two suites on the
second. Numbering: first digit = floor, second runs south to north along the corridor.

Sources: Harvard's housing portal (entryway Weld 1); Crimson 22 Nov 1983 (Weld 15 is first floor,
north side, and is JFK's renumbered Weld 32); Crimson 12 Sept 1951 (the pre-1962 scheme, which
dissolves the apparent 32→15 contradiction); a resident on Reddit ("Weld 1 is the first floor plus
two suites on the second floor").

### The room programme

Harvard's assignment: **2 bedrooms, 2 common rooms, ensuite bathroom, four occupants** — you,
three suitemates. Two doubles.

| Room | Size | Area | Source |
|---|---|---|---|
| Common room 1 | 15 × 20 | 300 | given; the 15–20 range is the section depth he could not read |
| Common room 2 ("K") | 10 × 12 | 120 | given; identified as a common room by Harvard's record |
| Bedroom A | 10 × 16 | 160 | given |
| Bedroom B | 10 × 16 | 160 | given |
| Bathroom | 7 × 8.5 | 60 | **inferred**, bounded 6–8 ft by two independent arithmetic checks |
| Hall | ~30 × 4 | ~120 | derived |
| **Total** | | **~920 sq ft** | 230 sq ft per person |

"K" is the second common room, almost certainly an original 1875 **study**. Three independent lines
agree: Harvard records two common rooms; the 1875 module is one study (16 × 17) plus bedrooms, so a
two-study suite reads as two original suites merged; and no Weld suite has a kitchen — in-suite
cooking is a rented microfridge, the kitchens are shared building facilities.

---

## 2. The decision

### Chosen: the suite runs north–south along one facade, ~25 ft deep × 44 ft long

```
                          N   (gable, 51 ft wide)
        party wall / neighbouring suite
   ---------------------------------------------
   |                                           |
   |   BEDROOM B    10 x 16     north + facade | <- ends the hall, corner room
   |-------------------------------------------|
   |   BATHROOM      7 x 8.5    interior       |
   |-------------------------------------------|
   |   BEDROOM A    10 x 16     facade         |
   |-------------------------------------------|
   |   COMMON 1     15 x 20     facade         | <- immediately right on entry
   |   + K          10 x 12     attached       |
   ---------------------------------------------
     ^ entry from the stair hall / corridor
                          S
   hall runs north along the inner wall, 4 ft, three doors
```

**Why this one:**

1. **The 44 ft arithmetic.** the resident's given room widths plus a 7 ft bathroom plus four partitions come
   to exactly 44.0 ft, against a section width derived from an 1875 source that knows nothing about
   his email. I had already fixed the bathroom at 6–8 ft before deriving 44 ft, so this was a
   prediction, not a fit. One chance in three of landing by luck — real evidence, not proof.
2. **It satisfies the 1875 daylight rule.** "No rooms receive an exclusively north light." Rooms face
   the east or west facade; bedroom B, at the gable, is a corner room with light in two directions.
   My earlier band of rooms across the north gable violated this outright.
3. **the resident's topology falls out naturally.** Entry in the inner wall at the south end, from the stair
   hall. Facing outward: right is the common room, left is the hall running north with bedroom A, the
   bathroom, then bedroom B where the hall ends. Every clause fits without strain.
4. **Efficiency checks out.** 25 × 44 = 1,100 sq ft gross against ~920 net = 82%, normal once walls
   and the hall are counted.
5. **Two suites per end section per floor** — east and west of a party wall — is consistent with
   Weld's five entryways of roughly 30 students.

**Which facade:** default **east**. A resident notes that on the first floor "there are only a
couple" of Yard-facing suites and most face the other way. West would be the better view — Grays,
Matthews, the elms — so this is the one worth hoping to be wrong about. Shipped as a toggle.

### Runner-up: the suite spans the building, ~22 ft deep × 51 ft wide

Kept because one first-hand account of a Weld four-person, two-bedroom suite describes exactly this.
Weld 54, on the fifth floor: *"The common room has a window with a view towards the yard, and each
bedroom has a window looking towards Boylston."* Common room and bedrooms on **opposite** facades
means that suite straddles the block rather than running along it.

Why it is not the default: it needs the entry in the middle of a long wall for "right" and "left" to
work as the resident describes, it fits the 44 ft module less cleanly, and a Weld 54 on the fifth floor sits
in a different section of a building that has been gutted twice.

**What would settle it:** the PIRC drawings — 1962 sheet A2 (first floor plan, ¼″ = 1′) and sheets
A7/A8 ("Typical suite plans and elevations", ⅜″ = 1′), by The Architects Collaborative. Catalogued,
digitised, access-restricted. Or a tape measure in September.

---

## 3. How this is handled in the model

Every inferred quantity is a control, not a constant:

| Control | Default | Range |
|---|---|---|
| Bathroom width | 7 ft | 6–8 |
| Hall width | 4 ft | 3–5 |
| Section length | 44 ft | 40–48 |
| Suite depth | 25 ft | 22–27 |
| Ceiling height | 10.75 ft | 9.5–11.5 |
| Facade | east | east / west |
| Layout | along-facade | along-facade / spanning |
| Beds per room | 2 and 2 | 1–3 each |

The provenance tag travels with each number in the UI: **given** by the housing office, **derived**
from a source, or **inferred** by me. Anything inferred is a slider.

---

## 4. Withdrawn

Recorded so they are not revived a third time.

- **"Weld is 54 × 151 ft."** Both wrong. 54 was one facade edge; 151 was the rotation-inflated
  bounding box.
- **"The layout closes exactly, which proves it."** Circular — the leftover was defined as the
  remainder.
- **"The leftover strip is the elevator shaft."** Withdrawn twice. The 1992–93 drawings put the
  elevator in the **south** stair core and the Crimson puts it at the **east** entrance; JFK's room
  was first floor north. The student-blog claim is folklore.
- **"The suite is a 20 × 49 band across the north gable."** Wrong orientation, and it violated the
  1875 daylight rule.
- **"Weld has wings in the middle third."** Backwards — the middle is the narrow waist.
- **"K has no window" / "K is a kitchen."** Both dead: no Weld suite has a kitchen, and K is a
  common room.
- **"87 ft tall."** 87.01 is the ridge; the mass is 60 ft to the eaves.
- **"The suite gets almost no direct sun."** It catches raking sun early and late from roughly late
  February to late October.
