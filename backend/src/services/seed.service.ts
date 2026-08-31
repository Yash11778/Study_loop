import mongoose from "mongoose";
import { Note } from "@/models/Note";
import { NoteChunk } from "@/models/NoteChunk";
import { authorNote } from "./notes.service";
import { embedAll } from "./ai/embeddings";
import { chunkSections, slugify } from "@/utils/chunk";
import { logger } from "@/utils/logger";

export type SeedSection = { title: string; brief: string };

export type SeedTopic = {
  subject: string;
  title: string;
  sections: ReadonlyArray<SeedSection>;
};

/**
 * The corpus the app reasons over: one note per topic, eight sections each.
 *
 * Several topics rather than one deep note is deliberate -- it gives the topic
 * filter something to filter, and lets a tester check that retrieval and the
 * quiz stay inside the topic they picked instead of bleeding across the corpus.
 *
 * Each topic closes on a misconceptions section. Those are the passages that
 * make Q&A worth using: they are where a student's actual confusion lives, and
 * they give the quiz generator plausible wrong answers instead of filler.
 */
export const SEED_TOPICS: ReadonlyArray<SeedTopic> = [
  {
    subject: "Physics",
    title: "Gravitation",
    sections: [
      {
        title: "Newton's Law of Universal Gravitation",
        brief:
          "F = G*m1*m2/r^2 with every symbol and unit defined. Point masses, and the shell theorem " +
          "result that a uniform sphere acts as if its mass sat at the centre -- which is why r is " +
          "measured centre to centre. The forces as an action-reaction pair, equal even when the " +
          "masses differ enormously.",
      },
      {
        title: "The Inverse-Square Law and G",
        brief:
          "Why the exponent is exactly 2, argued from flux over a sphere of area 4*pi*r^2. What " +
          "doubling separation does to the force. G = 6.674e-11 N*m^2/kg^2, why its smallness makes " +
          "everyday attraction unmeasurable, and the Cavendish experiment. The G versus g distinction.",
      },
      {
        title: "Gravitational Field Strength",
        brief:
          "The field g = F/m as force per unit mass in N/kg, a property of the source and location " +
          "that exists with no test mass present, unlike force which needs two masses. g = G*M/r^2. " +
          "Field lines pointing inward. Why N/kg and m/s^2 are numerically identical.",
      },
      {
        title: "Mass Versus Weight",
        brief:
          "Mass as an intrinsic scalar in kg that never changes; weight as W = m*g in newtons that " +
          "does. A 60 kg student on Earth, the Moon and in orbit, worked numerically. Why scales read " +
          "a normal force, what happens in an accelerating lift, and apparent weightlessness in free fall.",
      },
      {
        title: "Acceleration Due to Gravity",
        brief:
          "Deriving g = G*M/R^2 by equating m*g with the law of gravitation, showing the test mass " +
          "cancels -- why a feather and hammer fall together in vacuum. A worked value of g from " +
          "M = 5.972e24 kg and R = 6.371e6 m. Why g varies with latitude and altitude, and g at 400 km " +
          "being about 89 percent of surface g.",
      },
      {
        title: "Gravitational Potential Energy",
        brief:
          "U = -G*m1*m2/r and why the sign is negative with zero taken at infinity. U = m*g*h as the " +
          "near-surface approximation, derived as a limiting case, and where it stops being valid. " +
          "A worked energy change computed both ways to show the divergence. Potential V = -G*M/r in J/kg.",
      },
      {
        title: "Orbits and Escape Velocity",
        brief:
          "Equating gravity with the centripetal requirement to get v = sqrt(G*M/r), the orbiting mass " +
          "cancelling. Orbital period, and why higher orbits are slower. Kepler's third law, T^2 " +
          "proportional to r^3. Escape velocity sqrt(2*G*M/R), about 11.2 km/s for Earth, independent " +
          "of the escaping mass. Why an orbiting body is in free fall.",
      },
      {
        title: "Common Misconceptions",
        brief:
          "Each stated as the wrong belief then corrected with a reason: that there is no gravity in " +
          "space; that heavier objects fall faster; that mass and weight are interchangeable; that G " +
          "and g are the same; that the Moon is not falling; that centrifugal force holds satellites " +
          "up; that the inverse-square law is linear.",
      },
    ],
  },
  {
    subject: "Physics",
    title: "Laws of Motion",
    sections: [
      {
        title: "Inertia and the First Law",
        brief:
          "A body stays at rest or in uniform motion unless acted on by a net external force. Inertia " +
          "as resistance to change in motion and its dependence on mass alone. Inertial frames, and " +
          "why a passenger lurches forward when a bus brakes -- no forward force is involved.",
      },
      {
        title: "The Second Law",
        brief:
          "F_net = m*a as a vector relation, with the newton defined. That it is the NET force that " +
          "matters. Acceleration inversely proportional to mass for a fixed force. A worked example " +
          "computing acceleration from several forces acting at once, and the more general form in " +
          "terms of rate of change of momentum.",
      },
      {
        title: "The Third Law",
        brief:
          "Forces come in equal, opposite pairs acting on DIFFERENT bodies -- the whole content of the " +
          "law sits in that last point. Why paired forces never cancel each other. Worked examples: " +
          "walking, rocket propulsion, a book on a table (and why the normal force is not the third-law " +
          "partner of weight).",
      },
      {
        title: "Free-Body Diagrams",
        brief:
          "Isolating one body and drawing only the forces acting ON it. Weight, normal, tension, " +
          "friction, applied. Resolving into components along and perpendicular to motion. A worked " +
          "block on an inclined plane with m*g*sin(theta) and m*g*cos(theta) derived rather than quoted.",
      },
      {
        title: "Friction",
        brief:
          "Static versus kinetic friction, f = mu*N, and why static friction is a range up to a maximum " +
          "rather than a fixed value. Why friction does not depend on contact area in this model. " +
          "A worked example finding the angle at which a block begins to slide, giving tan(theta) = mu_s.",
      },
      {
        title: "Circular Motion",
        brief:
          "Centripetal acceleration a = v^2/r directed toward the centre, and that centripetal force is " +
          "a requirement met by real forces (tension, friction, gravity), not a new force. Why " +
          "centrifugal force appears only in a rotating frame. A worked example of a car on a flat " +
          "curve and the maximum speed friction allows.",
      },
      {
        title: "Momentum and Impulse",
        brief:
          "p = m*v as a vector, impulse J = F*t = change in momentum. Conservation of momentum for an " +
          "isolated system and how it follows from the third law. Why crumple zones and airbags reduce " +
          "force by extending contact time. A worked collision.",
      },
      {
        title: "Common Misconceptions",
        brief:
          "Each stated wrong then corrected: that motion requires a continuing force; that the third-law " +
          "pair cancels out; that centrifugal force pushes you outward in a car; that heavier objects " +
          "need more force to keep moving at constant speed; that friction always opposes motion (it " +
          "propels a walker); that an object moving up must have an upward force on it.",
      },
    ],
  },
  {
    subject: "Physics",
    title: "Work, Energy and Power",
    sections: [
      {
        title: "Work Done by a Force",
        brief:
          "W = F*d*cos(theta), the joule defined, and why work is a scalar despite force and " +
          "displacement being vectors. Zero work when the force is perpendicular to motion -- so a " +
          "carried bag and centripetal force do no work. Negative work by friction. A worked example " +
          "with a force at an angle.",
      },
      {
        title: "Kinetic Energy and the Work-Energy Theorem",
        brief:
          "KE = 0.5*m*v^2 and its derivation. The theorem that net work equals the change in kinetic " +
          "energy. Why doubling speed quadruples kinetic energy, and what that means for braking " +
          "distance. A worked stopping-distance problem.",
      },
      {
        title: "Potential Energy and Conservative Forces",
        brief:
          "Gravitational PE = m*g*h near the surface and elastic PE = 0.5*k*x^2. What makes a force " +
          "conservative: work depends only on endpoints, and round-trip work is zero. Why the zero " +
          "level is arbitrary and only differences matter. Friction as the standard non-conservative case.",
      },
      {
        title: "Conservation of Mechanical Energy",
        brief:
          "KE + PE constant when only conservative forces act. Solving problems by comparing two " +
          "states rather than tracking the path. A worked example of a ball down a frictionless " +
          "track, showing the final speed is independent of the shape of the path.",
      },
      {
        title: "Non-Conservative Forces and Energy Loss",
        brief:
          "The fuller statement where work done against friction appears as thermal energy. Energy is " +
          "conserved overall while mechanical energy is not. A worked example of a block sliding to " +
          "rest, finding the heat generated. Why perpetual motion machines fail.",
      },
      {
        title: "Power and Efficiency",
        brief:
          "P = W/t and the instantaneous form P = F*v, the watt defined. Average versus instantaneous " +
          "power. Efficiency as useful output over total input, always below 100 percent for a real " +
          "machine. A worked example of a motor lifting a load, and the kilowatt-hour as a unit of " +
          "energy rather than power.",
      },
      {
        title: "Collisions",
        brief:
          "Momentum conserved in all collisions; kinetic energy conserved only in elastic ones. " +
          "Perfectly inelastic collisions where bodies stick together. Worked examples of both, " +
          "showing where the lost kinetic energy goes. The coefficient of restitution.",
      },
      {
        title: "Common Misconceptions",
        brief:
          "Each stated wrong then corrected: that holding something heavy does work on it; that power " +
          "and energy are the same; that energy is destroyed by friction rather than converted; that " +
          "kinetic energy is proportional to speed; that momentum and kinetic energy are " +
          "interchangeable; that a machine can be more than 100 percent efficient.",
      },
    ],
  },
];

/**
 * Authors one topic, chunks it, derives its concept map, embeds every chunk and
 * stores the lot. Returns the note id.
 */
export async function seedTopic(topic: SeedTopic, reset = false): Promise<string> {
  const existing = await Note.findOne({ subject: topic.subject, title: topic.title, source: "seed" });

  if (existing && !reset) {
    logger.info({ id: String(existing._id), title: topic.title }, "already seeded; pass --reset to regenerate");
    return String(existing._id);
  }

  logger.info({ topic: topic.title, sections: topic.sections.length }, "authoring topic section by section");

  const authored = await authorNote(topic.subject, topic.title, topic.sections, (done, total, title) =>
    logger.info({ progress: `${done}/${total}`, section: title }, "section written")
  );

  logger.info(
    { topic: topic.title, words: authored.bodyMd.split(/\s+/).length },
    "topic authored"
  );

  const chunks = chunkSections(authored.sections);

  /**
   * The concept map comes from the syllabus the note was written from, not from
   * a model re-reading the finished prose. That was two extra calls that had to
   * swallow the entire note, which pushed them over the providers' token budget
   * as the corpus grew. It is also simply exact rather than inferred: these
   * slugs ARE the sections.
   */
  const concepts = authored.sections.map((section) => {
    const slug = slugify(section.title);
    return {
      slug,
      label: section.title,
      // The brief is a paragraph of instructions to the author; the concept
      // tooltip only wants its first sentence.
      summary: section.brief.split(". ")[0]!.trim() + ".",
      chunkOrdinals: chunks.filter((c) => c.sectionSlug === slug).map((c) => c.ordinal),
    };
  });

  const vectors = await embedAll(chunks.map((c) => c.content));

  const embedded = chunks.map((c, i) => {
    const embedding = vectors[i];
    if (!embedding) throw new Error(`missing embedding for chunk ${c.ordinal}`);
    return { ...c, embedding };
  });

  const session = await mongoose.startSession();
  let noteId = "";

  try {
    await session.withTransaction(async () => {
      /**
       * The old note is deleted here, not before authoring.
       *
       * Deleting up front meant a regeneration that failed part-way -- a spent
       * quota or a provider outage, both routine -- left the database with no
       * note at all, taking the topic down to replace one document.
       */
      if (existing) {
        logger.warn({ id: String(existing._id) }, "replacing the existing note");
        await NoteChunk.deleteMany({ noteId: existing._id }, { session });
        await Note.deleteOne({ _id: existing._id }, { session });
      }

      const created = await Note.create(
        [
          {
            subject: topic.subject,
            title: topic.title,
            bodyMd: authored.bodyMd,
            source: "seed",
            concepts,
            seededAt: new Date(),
          },
        ],
        { session }
      );

      const note = created[0];
      if (!note) throw new Error("note insert returned nothing");
      noteId = String(note._id);

      await NoteChunk.insertMany(
        embedded.map((c) => ({
          noteId: note._id,
          ordinal: c.ordinal,
          content: c.content,
          embedding: c.embedding,
          tokenCount: c.tokenCount,
        })),
        { session }
      );

      logger.info({ id: noteId, topic: topic.title, chunks: chunks.length }, "topic seeded");
    });
  } finally {
    await session.endSession();
  }

  return noteId;
}

/**
 * Seeds every topic in turn.
 *
 * One topic failing does not abandon the ones already stored, and the run
 * reports what got through -- a partial corpus is a working app with fewer
 * topics, which beats an empty one.
 */
export async function seedAll(reset = false) {
  const seeded: string[] = [];
  const failed: Array<{ topic: string; error: string }> = [];

  for (const topic of SEED_TOPICS) {
    try {
      await seedTopic(topic, reset);
      seeded.push(topic.title);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ topic: topic.title, err: message }, "topic failed");
      failed.push({ topic: topic.title, error: message });
    }
  }

  return { seeded, failed };
}
