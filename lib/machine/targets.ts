/**
 * One entry per ICP. This is the file you edit.
 *
 * Adding a country is a copy with a changed `locations`. Adding a vertical is a
 * copy with changed `industryIds` and a changed `qualifyPrompt`. Nothing else in
 * lib/machine knows what an accounting firm is.
 *
 * LinkedIn industry IDs come from the V2 taxonomy:
 * https://github.com/HarvestAPI/linkedin-industry-codes-v2
 */

export type CompanyCategory =
  | "firm"
  | "association"
  | "network"
  | "vendor"
  | "service"
  | "unsure";

/**
 * Which categories get their own working list, and what that tab is called.
 *
 * Everything harvested always stays in the Companies tab. These are copies, so a
 * category can be re-routed later without losing anything. A category absent from
 * this map simply has no list of its own yet.
 *
 * Associations and networks are here on purpose. A syllogos is not a client but
 * it is a room full of them, and a network affiliate is still a small Greek
 * office with a local managing partner. Both are plays, just not the same play.
 */
export const CATEGORY_LISTS: Partial<Record<CompanyCategory, string>> = {
  firm: "Qualified",
  network: "Networks",
  association: "Associations",
};

/** Categories stage 3 pulls decision makers for. */
export const PEOPLE_CATEGORIES: CompanyCategory[] = ["firm"];

export type Target = {
  id: string;
  label: string;
  /** Apify `harvestapi/linkedin-company-search` input. */
  company: {
    searchQuery: string;
    locations: string[];
    industryIds: string[];
    companySize: string[];
  };
  /** Prepended to the shared classifier prompt. Describes this vertical only. */
  qualifyPrompt: string;
  /** Apify `harvestapi/linkedin-profile-search` input, used by stage 3. */
  people: {
    currentJobTitles: string[];
    locations: string[];
  };
  /**
   * The actor has no NOT operator, so LinkedIn Boolean exclusions live here and
   * are applied by our own code. Matched case-insensitively against the name.
   */
  denylist: string[];
};

export const TARGETS: Target[] = [
  {
    id: "gr-accounting",
    label: "Greek accounting firms",
    company: {
      searchQuery: "",
      locations: ["Athens, Attiki, Greece", "Greece"],
      industryIds: ["47"], // Accounting
      companySize: ["1-10", "11-50"],
    },
    qualifyPrompt: `The buyer is looking for independent Greek accounting and tax
practices (λογιστικά γραφεία, φοροτεχνικοί) that sell their services to Greek
businesses. Firms of 1 to 50 people, owner-run, not part of an international
network.`,
    people: {
      currentJobTitles: [
        "Ιδιοκτήτης",
        "Ιδρυτής",
        "Founder",
        "Co-Founder",
        "Owner",
        "CEO",
        "Managing Director",
        "Managing Partner",
        "Partner",
        "Διευθύνων Σύμβουλος",
        "Γενικός Διευθυντής",
      ],
      locations: ["Greece"],
    },
    denylist: [],
  },

  // Ready to enable once the accounting pilot clears its hit-rate gate.
  // Industry IDs already resolved, prompts still need writing.
  //
  // gr-clinics   industryIds: ["13", "2081"]   Medical Practices, Hospitals
  // gr-hotels    industryIds: ["2194", "31"]   Hotels and Motels, Hospitality
  //              denylist: ["Marriott", "Hilton", "Grecotel"]
  // gr-exporters industryIds: ["134"]          Wholesale Import and Export
];

export function getTarget(id: string): Target {
  const target = TARGETS.find((candidate) => candidate.id === id);
  if (!target) throw new Error(`Unknown target: ${id}`);
  return target;
}
