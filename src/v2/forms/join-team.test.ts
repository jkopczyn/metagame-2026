import { describe, expect, it } from "vitest";
import { INTEREST_OPTIONS } from "@/lib/interests";
import {
  airtableFields,
  allQuestions,
  checkForm,
  visibleItems,
  visibleSteps,
  type Answers,
} from "./engine";
import { FORMS } from "./index";

describe("join team", () => {
  const def = FORMS["join-team"];
  const visible = (a: Answers) =>
    visibleSteps(def, a).flatMap((s) => visibleItems(s, a).map((i) => i.key));

  it("asks volunteers and organizers about skills, and sponsors for a name", () => {
    expect(visible({})).not.toContain("skills");
    expect(visible({ interests: ["volunteering"] })).toContain("skills");
    expect(visible({ interests: ["organizing"] })).toContain("skills");
    expect(visible({ interests: ["speaking"] })).not.toContain("skills");
    expect(visible({ interests: ["sponsoring"] })).toContain("company");
    expect(visible({ interests: ["speaking"] })).not.toContain("company");
  });

  it("needs only a name and an email", () => {
    expect(Object.keys(checkForm(def, {})).sort()).toEqual(["email", "name"]);
    expect(checkForm(def, { name: "Ada", email: "ada@example.com" })).toEqual(
      {},
    );
  });

  it("offers every interest the email signup knows, by the same name", () => {
    const q = allQuestions(def).find((x) => x.key === "interests")!;
    const values = q.type === "choices" ? q.options.map((o) => o.value) : [];
    for (const o of INTEREST_OPTIONS) expect(values).toContain(o.value);
    expect(
      airtableFields(def, {
        name: "Ada",
        email: "ada@example.com",
        interests: ["volunteering", "email list"],
      }).fldmLx6E4fpMxaVHw,
    ).toEqual(["volunteering", "email list"]);
  });
});
