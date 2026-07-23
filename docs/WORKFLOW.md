# JHTV Second Brain — How the Workflow Works

*A walkthrough of how JHTV staff use the tool, where it's headed, and what would make each
part better. Each step is read in three layers:*

> **Today** — how it works right now ·  **Future** — where we're taking it ·  **To improve** — what would make it better, and the ask

---

## The shape of it: two connected tools

There are **two front doors, sharing one brain**:

- **Second Brain (internal)** — the JHTV staff tool. Staff start here.
- **Grant Finder (external)** — a self-service site professors and founders can use on their own.

They're connected: when Second Brain reaches the **non-dilutive (grant)** part of a company's
funding picture, it hands off to the same grant engine that powers the external Grant Finder — so
the two tools can never give different answers.

Inside **Second Brain**, staff enter from one of **two directions**: starting from a **JHTV
technology / start-up**, or starting from a **VC firm**. Both roads lead to the same goal — the
full funding picture for a Hopkins company.

---

## Entry A — Start from a JHTV technology (the start-up view)

A staff member opens a JHTV start-up and sees its **funding profile** — think of it as a
one-look "rolodex deck" for that company: its stage, sector, and thesis, and the **VCs that fit
it**, ranked and split into **firms JHTV already has a relationship with** vs. **new prospects**.

**Today.** The profile is built from what we know about the technology. It matches the company to
investors by fit (sector, stage, check size, geography) and flags which of those firms are already
in JHTV's network. *One real gap:* the profile shows the funding *fit*, but **not who has actually
invested** in comparable companies — we can infer the right *type* of investor, but not point to
real, recent deals.

**Future.** The technology becomes the **hub of the whole funding picture** — one page that shows,
for any Hopkins company: the VC matches, the **non-dilutive grants it likely qualifies for**, the
**warm intros** through Hopkins alumni, and a downloadable one-pager. The "JHTV relationship vs.
new prospect" split is powered by a **real, tiered list of the firms JHTV works with most.**

**To improve — and the ask.**
- **Show who actually invested.** Real deal data (who led, who co-invested, how big the round was)
  turns "this *type* of firm fits" into "*these* firms have funded companies like this." → *Needs
  PitchBook data* (available through Stew's PitchBook/Bloomberg seat in the Commercialization Academy).
- **Fill the relationship tiers.** The "firms JHTV works with" list is wired in but currently
  empty. → *Needs a tiered export of JHTV/JHU co-investment history* (Bloomberg terminal).

---

## Entry B — Start from a VC firm (the VC view)

A staff member searches a VC firm and sees everything JHTV needs to know to work with them.

### JHU connections — our warm intros
Every firm is matched against the **Hopkins alumni network** to surface people at that firm who can
open a door.

- **Today.** Sourced from a **live Excel sheet** of the JHU/VC network, converted into the tool.
  The matching handles messy firm-name variations (aliases, typos, "NEA (New Enterprise
  Associates)," etc.).
- **Future.** The sheet is **truly live-synced** — someone updates the Excel, and the tool reflects
  it automatically, no manual step.
- **To improve — and the ask.** Right now the sheet has to be manually re-imported. Making it
  auto-sync is blocked on one thing: the file needs to live somewhere a background job can reach it
  with the right sign-in. → *Needs the network Excel hosted in JHU OneDrive/SharePoint with access
  set up* (a one-time IT/authorization step).

### Matched technologies + one-pagers
The firm is matched to its **top 4 JHTV technologies**, each with a **preview / downloadable
one-pager**.

- **Today.** Top matches come from the scoring rubric; one-pagers are hand-made PDFs, with an
  auto-generated fallback for firms we've only researched.
- **Future.** One-pagers generate on demand for any firm, and each match carries a **confidence
  indicator** so a hand-verified match visibly outranks an auto-researched guess.

### Investor fit, stage, thesis & preliminary (non-dilutive) matches
The firm's **investment thesis, stage focus, and fit** are laid out, including a **preliminary
screen of non-dilutive (grant) matches**.

- **Today (rubric v2, portfolio-led).** Fit is scored on three factors — **Portfolio (55%),
  Stage-check (30%), Sector (15%)**. The heaviest factor is the firm's *actual* portfolio: what it
  has really funded outweighs the sectors it lists on its website. Portfolio depth passes through a
  **de-saturating curve** so a deeper, closer portfolio always outscores a shallower one, and
  same-score matches break ties by **how recently** the firm invested in the tech's domain. The
  rubric lives in **one shared place** (`scoring.js`), so the ranking staff see and the matches the
  tool auto-generates can never disagree.
- **Future.** Extend the real-behavior signals further — a firm's stage mix and typical round sizes
  per sector, whether it's actively deploying a fresh fund, and whether it backs university spin-outs
  (probably our single strongest signal).
- **To improve — and the ask.**
  - The three weights are a reasoned, boss-approved blend but **haven't been validated against real
    outcomes.** With a record of which JHTV companies actually raised from whom, we could tune them
    to reality. → *Needs outcome data* (limited today — so near-term we treat the weights as a clearly
    labeled, easily-adjustable setting).
  - Portfolios are scraped for the 12 curated firms; **auto-researched firms still lack them** and
    score on stated profile alone (capped below "Strong"). Broader portfolio + deal-size data would
    close the gap. → *Needs PitchBook data.*

---

## The hand-off — non-dilutive funding → Grant Finder

From the **preliminary grant matches**, the tool reaches out to the **external Grant Finder**.

- **Today.** Staff see the grants a company likely qualifies for right inside Second Brain, and a
  **"Refine eligibility"** step opens the full questionnaire prefilled for that company. The
  external Grant Finder stays live so professors and founders can self-serve. *(This embedded grant
  experience is already built and live.)*
- **Future.** Both front doors run off the **same shared grant engine** — one source of truth,
  updated once, correct everywhere. *(This is how it works today — the foundation is in place.)*

---

## The asks, in one place

Everything above points at a short list of things that would move the tool from "smart estimates"
to "backed by real data":

| What would improve it | Where it helps | What it needs |
|---|---|---|
| **Real investor behavior** — who actually invested, stage mix, round sizes, active funds | VC matching, fit scoring, the start-up funding profile | **PitchBook data** (Stew's PitchBook/Bloomberg seat, Commercialization Academy) |
| **Tiered JHTV relationship list** — which firms JHTV works with, ranked | The "relationship vs. new prospect" split | **Bloomberg export** of JHTV/JHU co-investment history |
| **Auto-syncing JHU network** — edit the sheet, tool updates itself | Warm-intro connections | **Network Excel in JHU OneDrive/SharePoint** + access set up |
| **Validated scoring** — weights tuned to reality, not judgment | Trust in every fit score | **Outcome data**: which JHTV companies raised, and from whom |

---

## Where things stand today

Recently shipped, so the boss sees momentum:
- **Grant funding is now built into the staff tool** (auto-screen + refine), while the external
  Grant Finder stays live for founders.
- **The scoring logic was unified into one place** — no more risk of the tool disagreeing with
  itself.
- **Both public sites are live** and the tool is in use.

*This document is a companion to the technical deep-dive in `HOW-IT-WORKS.md`; this one is the
workflow and the roadmap, that one is the machinery.*
