/**
 * Why they are learning German.
 *
 * The road to Germany was, until now, the same road for everybody: levels, an
 * exam, documents, a visa, an arrival. That is the school's road. It is not the
 * student's. A nurse from Enugu and a nineteen-year-old chasing an Ausbildung
 * place are walking to two completely different buildings, and a map that
 * cannot tell them apart is a map neither of them is really on.
 *
 * WHY THERE IS NO AI HERE.
 *
 * The obvious build is a text box — "what is your goal?" — and a model that
 * invents a road from the answer. We are not doing that, for three reasons:
 *
 *   1. THE ANSWER SPACE IS SMALL AND KNOWN. Every student who has ever walked
 *      into this school is going to Germany for one of eight reasons. A list of
 *      eight is not a limitation, it is the actual shape of the problem, and a
 *      list can be tapped in two seconds where a text box has to be composed.
 *   2. A GENERATED ROAD IS A ROAD NOBODY CHECKED. The stages below name real
 *      German requirements — a blocked account, Anerkennung, the A1 a spouse
 *      visa asks for. A model that hallucinated one of those would put a false
 *      immigration requirement on the dashboard of somebody making plans
 *      around it. Every line here is written once, by a person, and reviewed.
 *   3. THE MAP MUST BE THE SAME MAP TOMORROW. A student screenshots this and
 *      sends it to their mother. It cannot quietly re-generate itself into a
 *      different set of steps next week.
 *
 * `custom` exists for the ninth person, and it gets the honest generic road
 * plus their own words back, rather than a guess.
 *
 * WHAT IS AND IS NOT A PROMISE. Every requirement below is what German
 * authorities and employers USUALLY ask for, and every goal carries a
 * `disclaimer` that the UI is required to render next to it. This school does
 * not process visas and must never look like it is guaranteeing one — see the
 * same rule in the pay-in-full work.
 *
 * NO PRISMA, NO REACT. Pure data, imported by both halves of the journey.
 */

import { LEVELS } from "@/lib/levels";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type GoalId =
  | "study"
  | "ausbildung"
  | "work"
  | "care"
  | "family"
  | "aupair"
  | "settle"
  | "explore"
  | "custom";

/** Which drawn landmark stands where on the world map. */
export type SceneryKind =
  | "gate"
  | "castle"
  | "cathedral"
  | "tower"
  | "campus"
  | "clinic"
  | "workshop"
  | "home"
  | "houses"
  | "turbines"
  | "forest"
  | "alps";

/** Icon key resolved by the picker. Kept as a string so this file stays pure. */
export type GoalIconKey =
  | "graduation"
  | "toolbox"
  | "briefcase"
  | "care"
  | "heart"
  | "family"
  | "home"
  | "compass"
  | "sparkles";

export type GoalStage = {
  id: string;
  /** First person. The sentence they are walking towards. */
  voice: string;
  /** Two or three words under the node. */
  label: string;
  /** What the road says back once it is true. */
  echo: string;
  /** The one line visible while it is still sealed. */
  teaser: string;
  /** The group this stage admits them to, or null. */
  tribe: string | null;
  /**
   * Everything after the classroom is the student's word — we do not run the
   * embassy. Left explicit rather than assumed so a future school-verified
   * stage can sit in the same list.
   */
  selfReported: boolean;
};

export type GermanyGoal = {
  id: GoalId;
  /** What they tap. Written as something they would say about themselves. */
  label: string;
  /** The line under the label on the card. */
  blurb: string;
  /**
   * The sentence at the top of their map, in their voice. This is the single
   * most-read string in the feature — it is the reason they enrolled, said
   * back to them, every time they open the portal.
   */
  dream: string;
  /** Where the road ends, named. "your first lecture", "your ward". */
  destination: string;
  /** The level this route usually asks for. */
  requiredLevel: string;
  /**
   * WHY that level. Shown always. An unexplained "you need B2" from a school
   * that sells B2 courses reads as a sales tactic, and deserves to.
   */
  levelReason: string;
  /** Months to allow for this route's paperwork in the arrival projection. */
  paperworkMonths: number;
  /** The line that must render wherever this goal's requirements are shown. */
  disclaimer: string;
  /** Base hue for this goal's sky and terrain. */
  hue: number;
  /** The landmarks drawn on the far half of the world. */
  scenery: SceneryKind[];
  icon: GoalIconKey;
  /** The stages between the last classroom and the destination. */
  stages: GoalStage[];
};

/* -------------------------------------------------------------------------- */
/* Shared stages                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The certificate stage, which every route passes through.
 *
 * Parameterised by level because "I passed B1" and "I passed C1" are not the
 * same sentence and should not be printed as though they were.
 */
function examStage(level: string, exam = "ÖSD / telc"): GoalStage {
  return {
    id: "exam",
    voice: `I sat the ${level} exam and I passed.`,
    label: `${exam} ${level}`,
    echo: "Your German is now a document with your name on it, not a claim.",
    teaser: "The certificate the people on the other side actually read.",
    tribe: "The Certified",
    selfReported: true,
  };
}

const VISA_STAGE = (what: string): GoalStage => ({
  id: "visa",
  voice: "I have my visa. I have a date.",
  label: what,
  echo: "There is a date on a page now. That is the whole thing becoming real.",
  teaser: "An appointment, a stamp, and a departure date.",
  tribe: "The Departing",
  selfReported: true,
});

const DOCUMENTS_STAGE: GoalStage = {
  id: "documents",
  voice: "My file is complete. Interview done, documents in.",
  label: "Documents & interview",
  echo: "The paperwork stage ends more journeys than the language ever does. Not yours.",
  teaser: "Transcripts, translations, the interview. The quiet stage that stops most people.",
  tribe: null,
  selfReported: true,
};

/* -------------------------------------------------------------------------- */
/* The eight roads                                                            */
/* -------------------------------------------------------------------------- */

export const GERMANY_GOALS: GermanyGoal[] = [
  {
    id: "study",
    label: "I am going to study in Germany",
    blurb: "A degree at a German university.",
    dream: "I am going to sit in a German lecture hall as a student.",
    destination: "your first lecture",
    requiredLevel: "C1",
    levelReason:
      "German-taught degrees usually ask for C1 — DSH-2 or TestDaF 4x4. English-taught programmes ask for less German, but the life around them still runs in it.",
    paperworkMonths: 6,
    disclaimer: "What universities usually ask for. Each one publishes its own requirements — always check the course page.",
    hue: 224,
    scenery: ["campus", "cathedral", "gate"],
    icon: "graduation",
    stages: [
      examStage("C1", "TestDaF / DSH"),
      {
        id: "application",
        voice: "My application is in.",
        label: "Uni application",
        echo: "Somebody in a German admissions office is now reading your name.",
        teaser: "uni-assist, certified transcripts, and the deadline that does not move.",
        tribe: null,
        selfReported: true,
      },
      {
        id: "admission",
        voice: "I have my admission letter.",
        label: "Admission letter",
        echo: "A German university has written your name on a place. Keep that letter.",
        teaser: "The letter that turns an application into a seat.",
        tribe: "The Admitted",
        selfReported: true,
      },
      {
        id: "finance",
        voice: "My blocked account is funded.",
        label: "Blocked account",
        echo: "The money question is answered. That is the one most files fall down on.",
        teaser: "The Sperrkonto — proof you can live there for a year.",
        tribe: null,
        selfReported: true,
      },
      VISA_STAGE("Student visa"),
      {
        id: "arrival",
        voice: "I made it. I am a student in Germany.",
        label: "First lecture",
        echo: "You said it, and then you did it. Send us the photo from the lecture hall.",
        teaser: "The end of this road and the first day of the next one.",
        tribe: "The Arrived",
        selfReported: true,
      },
    ],
  },

  {
    id: "ausbildung",
    label: "I am going for an Ausbildung",
    blurb: "Paid vocational training with a German employer.",
    dream: "I am going to train in Germany and be paid while I learn.",
    destination: "your first day of training",
    requiredLevel: "B1",
    levelReason:
      "Most Ausbildung contracts name B1. The stronger employers, and most nursing and technical trades, ask for B2 — so B1 opens the door and B2 lets you pick.",
    paperworkMonths: 5,
    disclaimer: "What employers and the visa route usually ask for. Your contract and your consulate have the final word.",
    hue: 28,
    scenery: ["workshop", "houses", "gate"],
    icon: "toolbox",
    stages: [
      examStage("B1"),
      {
        id: "placement",
        voice: "A German employer offered me a place.",
        label: "Ausbildung contract",
        echo: "Somebody in Germany has committed to training you. That is rarer than the language.",
        teaser: "The contract with a company name, a trade and a start date on it.",
        tribe: "The Placed",
        selfReported: true,
      },
      DOCUMENTS_STAGE,
      VISA_STAGE("Training visa"),
      {
        id: "arrival",
        voice: "I made it. I start my Ausbildung.",
        label: "First day at work",
        echo: "Paid to learn, in Germany. Send us the photo in the uniform.",
        teaser: "The end of this road and the first day of the next one.",
        tribe: "The Arrived",
        selfReported: true,
      },
    ],
  },

  {
    id: "work",
    label: "I am going to work in Germany",
    blurb: "A skilled job with my qualification.",
    dream: "I am going to work in Germany in the trade I already know.",
    destination: "your first day at work",
    requiredLevel: "B2",
    levelReason:
      "B2 is where employers stop treating your German as a risk. It is also the level most professional recognition files are measured against.",
    paperworkMonths: 6,
    disclaimer: "What the skilled-worker routes usually ask for. Recognition rules differ by profession and by Bundesland.",
    hue: 200,
    scenery: ["tower", "turbines", "houses"],
    icon: "briefcase",
    stages: [
      examStage("B2"),
      {
        id: "recognition",
        voice: "My qualification is recognised in Germany.",
        label: "Anerkennung",
        echo: "What you already know now counts there too. That took months and you did it.",
        teaser: "Anerkennung — getting your certificate accepted as a German one.",
        tribe: null,
        selfReported: true,
      },
      {
        id: "offer",
        voice: "I have a job offer.",
        label: "Job offer",
        echo: "A German company wants you specifically. Not a category — you.",
        teaser: "A contract, a salary and a start date.",
        tribe: "The Hired",
        selfReported: true,
      },
      VISA_STAGE("Work visa"),
      {
        id: "arrival",
        voice: "I made it. I am working in Germany.",
        label: "First day at work",
        echo: "You changed the country your salary is paid in. Send us the photo.",
        teaser: "The end of this road and the first day of the next one.",
        tribe: "The Arrived",
        selfReported: true,
      },
    ],
  },

  {
    id: "care",
    label: "I am going into nursing or care",
    blurb: "A ward, a care home, a clinic.",
    dream: "I am going to nurse in Germany.",
    destination: "your ward",
    requiredLevel: "B2",
    levelReason:
      "Care work is a spoken job with a patient at the end of it, so B2 is the floor almost everywhere — usually B1 to start the recognition and B2 to practise.",
    paperworkMonths: 7,
    disclaimer: "What nursing recognition usually asks for. Each Bundesland runs its own process and its own timetable.",
    hue: 168,
    scenery: ["clinic", "houses", "cathedral"],
    icon: "care",
    stages: [
      examStage("B2"),
      {
        id: "recognition",
        voice: "My licence is being recognised.",
        label: "Anerkennung",
        echo: "Your training is being written into German law as valid. Few people get this far.",
        teaser: "Berufsanerkennung — your nursing licence, accepted there.",
        tribe: null,
        selfReported: true,
      },
      {
        id: "placement",
        voice: "A German hospital offered me a contract.",
        label: "Employer contract",
        echo: "There is a ward with a rota that has your name pencilled on it.",
        teaser: "A hospital or care home, a contract, a start date.",
        tribe: "The Hired",
        selfReported: true,
      },
      VISA_STAGE("Work visa"),
      {
        id: "arrival",
        voice: "I made it. I am on the ward.",
        label: "First shift",
        echo: "Someone in Germany is being cared for by you today. Send us the photo.",
        teaser: "The end of this road and the first day of the next one.",
        tribe: "The Arrived",
        selfReported: true,
      },
    ],
  },

  {
    id: "family",
    label: "I am joining my family",
    blurb: "A spouse, a parent, a child already there.",
    dream: "I am going to live in the same house as my family again.",
    destination: "the arrivals gate",
    requiredLevel: "A1",
    levelReason:
      "A spouse visa usually asks for A1 and nothing more — so your visa is closer than you think. Everything above A1 is not for the embassy. It is for the twenty years after you land.",
    paperworkMonths: 5,
    disclaimer: "What family reunification usually asks for. Your consulate decides your case, and there are exemptions.",
    hue: 340,
    scenery: ["home", "houses", "forest"],
    icon: "family",
    stages: [
      examStage("A1"),
      {
        id: "documents",
        voice: "Our documents are certified and in.",
        label: "Documents",
        echo: "Marriage certificates, birth certificates, translations, apostilles. The unglamorous stage nobody warns you about.",
        teaser: "Certificates, translations and legalisation.",
        tribe: null,
        selfReported: true,
      },
      {
        id: "appointment",
        voice: "I have my embassy appointment.",
        label: "Embassy appointment",
        echo: "A date, a building, a queue. After months of forms, a real appointment.",
        teaser: "The appointment slot everyone refreshes their inbox for.",
        tribe: null,
        selfReported: true,
      },
      VISA_STAGE("Family visa"),
      {
        id: "arrival",
        voice: "I made it. We are in the same place again.",
        label: "Together",
        echo: "The road was never really about German. Send us the photo at the airport.",
        teaser: "The end of this road and the start of the rest of it.",
        tribe: "The Arrived",
        selfReported: true,
      },
    ],
  },

  {
    id: "aupair",
    label: "I am going as an au pair",
    blurb: "A host family, a year, a way in.",
    dream: "I am going to live with a German family and learn the country from inside a home.",
    destination: "your host family's door",
    requiredLevel: "A2",
    levelReason:
      "The au pair route usually asks for basic German — A1 at minimum, A2 in practice, because you will be talking to children all day and children do not simplify.",
    paperworkMonths: 4,
    disclaimer: "What the au pair route usually asks for. Your agency and your consulate set the actual conditions.",
    hue: 46,
    scenery: ["home", "forest", "castle"],
    icon: "heart",
    stages: [
      examStage("A2"),
      {
        id: "host",
        voice: "A host family chose me.",
        label: "Host family",
        echo: "A family in Germany read about you and said yes. That is a real thing to have happened.",
        teaser: "The family, the town, the children's names.",
        tribe: "The Matched",
        selfReported: true,
      },
      {
        id: "contract",
        voice: "My au pair contract is signed.",
        label: "Au pair contract",
        echo: "Hours, pocket money, language-course time. All of it in writing.",
        teaser: "The written agreement that protects your year.",
        tribe: null,
        selfReported: true,
      },
      VISA_STAGE("Au pair visa"),
      {
        id: "arrival",
        voice: "I made it. I am living with my host family.",
        label: "Moving in",
        echo: "You are inside a German household, learning the language the way children do. Send us the photo.",
        teaser: "The end of this road and the first day of the next one.",
        tribe: "The Arrived",
        selfReported: true,
      },
    ],
  },

  {
    id: "settle",
    label: "I am moving there for good",
    blurb: "A life, not a trip.",
    dream: "I am going to build a life in Germany and stay.",
    destination: "your own front door",
    requiredLevel: "B1",
    levelReason:
      "Permanent residence usually asks for B1, and citizenship asks for B1 and up. It is the level the German state itself has decided means you can live there.",
    paperworkMonths: 8,
    disclaimer: "What settlement usually asks for. Residence and citizenship rules change — the Ausländerbehörde decides your case.",
    hue: 262,
    scenery: ["houses", "gate", "alps"],
    icon: "home",
    stages: [
      examStage("B1"),
      DOCUMENTS_STAGE,
      VISA_STAGE("Entry visa"),
      {
        id: "arrival",
        voice: "I made it. I live in Germany.",
        label: "Landed",
        echo: "Anmeldung, a bank account, a key of your own. The admin nobody photographs.",
        teaser: "The landing, and the fortnight of forms after it.",
        tribe: "The Arrived",
        selfReported: true,
      },
      {
        id: "residence",
        voice: "I have my residence permit. I am staying.",
        label: "Residence permit",
        echo: "You are not a visitor any more. That is the whole thing, finished.",
        teaser: "The permit that turns a stay into a life.",
        tribe: "The Settled",
        selfReported: true,
      },
    ],
  },

  {
    id: "explore",
    label: "I am learning it for myself",
    blurb: "Travel, family roots, or the pleasure of it.",
    dream: "I am going to stand in Germany and understand every word around me.",
    destination: "a café in Germany",
    requiredLevel: "B1",
    levelReason:
      "B1 is where a language stops being homework and starts being useful — you can follow a conversation you are not part of. There is no authority to satisfy on this road. Only you.",
    paperworkMonths: 2,
    disclaimer: "No visa route is assumed here. If that changes, you can change your goal at any time.",
    hue: 96,
    scenery: ["castle", "forest", "cathedral"],
    icon: "compass",
    stages: [
      examStage("B1"),
      {
        id: "trip",
        voice: "I booked the trip.",
        label: "The trip",
        echo: "A date, a flight and a reason. Everything before this was rehearsal.",
        teaser: "The booking that makes all of it worth it.",
        tribe: null,
        selfReported: true,
      },
      {
        id: "arrival",
        voice: "I made it. I ordered my coffee in German, in Germany.",
        label: "Angekommen",
        echo: "You understood the reply. That is the moment everyone remembers. Send us the photo.",
        teaser: "The end of this road and the start of using it.",
        tribe: "The Arrived",
        selfReported: true,
      },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* The ninth person                                                           */
/* -------------------------------------------------------------------------- */

/**
 * "Something else."
 *
 * Deliberately NOT a hidden ninth card that quietly guesses. It gets the honest
 * generic road — the one the map had before goals existed — and a free-text box
 * whose answer is shown back to them at the top of their own map and read by
 * the branch. Somebody with a reason we did not predict is the most interesting
 * person in the database, not an edge case to be smoothed over.
 */
export const CUSTOM_GOAL: GermanyGoal = {
  id: "custom",
  label: "Something else",
  blurb: "Tell us in your own words.",
  dream: "I am going to Germany.",
  destination: "Germany",
  requiredLevel: "B2",
  levelReason:
    "B2 is where most doors in Germany open — work, training and most of everyday life. Tell us your reason and your branch will tell you the level it actually needs.",
  paperworkMonths: 5,
  disclaimer: "A general road. Once you tell us your reason, your branch can correct the steps for you.",
  hue: 265,
  scenery: ["gate", "castle", "houses"],
  icon: "sparkles",
  stages: [
    examStage("B2"),
    DOCUMENTS_STAGE,
    VISA_STAGE("Visa & travel"),
    {
      id: "arrival",
      voice: "I made it. I am in Germany.",
      label: "Deutschland",
      echo: "You said it, and then you did it. Send us the photo.",
      teaser: "The end of this road and the start of the next one.",
      tribe: "The Arrived",
      selfReported: true,
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* Lookup                                                                     */
/* -------------------------------------------------------------------------- */

const ALL_GOALS = [...GERMANY_GOALS, CUSTOM_GOAL];

/**
 * The goal a student picked, or the honest generic road.
 *
 * Falls back to `custom` rather than to the first goal in the list: a student
 * who has not answered yet must not be silently filed as a university
 * applicant, because the map would then show them a blocked account they never
 * asked about.
 */
export function goalFor(id: string | null | undefined): GermanyGoal {
  const found = ALL_GOALS.find((goal) => goal.id === String(id ?? "").trim().toLowerCase());
  return found ?? CUSTOM_GOAL;
}

export function isKnownGoal(id: string | null | undefined): boolean {
  return ALL_GOALS.some((goal) => goal.id === String(id ?? "").trim().toLowerCase());
}

/**
 * The higher of where the student is heading anyway and where this goal needs
 * them to be.
 *
 * NEVER LOWER. A student whose file says C1 and who picks the family-reunion
 * goal keeps their C1 road — picking a goal is telling us what you are FOR,
 * not asking us to shorten your course. The other direction is fair game: a
 * goal that needs C1 lengthens a B2 road, because that is information they need
 * before they finish B2 and discover it was not enough.
 */
export function levelForGoal(goal: GermanyGoal, currentTarget: string | null | undefined): string {
  const levels = LEVELS as readonly string[];
  const a = levels.indexOf(String(currentTarget ?? "").toUpperCase());
  const b = levels.indexOf(goal.requiredLevel.toUpperCase());
  const highest = Math.max(a, b);
  return highest < 0 ? goal.requiredLevel : levels[highest];
}
