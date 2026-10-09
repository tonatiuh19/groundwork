import { describe, expect, it } from "vitest";
import {
  applyConversationTemplate,
  applyConversationTemplateVars,
  buildConversationMergeVars,
  getOpenVariableToken,
} from "./conversationTemplateVars";

describe("conversationTemplateVars", () => {
  it("builds merge vars with fallbacks", () => {
    expect(
      buildConversationMergeVars({
        first_name: "Ada",
        last_name: "Lovelace",
        phone: "+15551234567",
      }),
    ).toEqual({
      first_name: "Ada",
      last_name: "Lovelace",
      full_name: "Ada Lovelace",
      phone: "+15551234567",
      client_status: "",
    });
    expect(buildConversationMergeVars({}).first_name).toBe("there");
  });

  it("replaces known tokens and leaves unknowns", () => {
    expect(
      applyConversationTemplateVars("Hi {{first_name}} {{missing}}", {
        first_name: "Ada",
      }),
    ).toBe("Hi Ada {{missing}}");
  });

  it("picks Spanish body when present", () => {
    const filled = applyConversationTemplate(
      {
        id: 1,
        title: "Hello",
        body_en: "Hi {{first_name}}",
        body_es: "Hola {{first_name}}",
        is_active: true,
        sort_order: 0,
      },
      { first_name: "Ada" },
      "es",
    );
    expect(filled.body).toBe("Hola Ada");
  });

  it("detects open {{token for suggestions", () => {
    expect(getOpenVariableToken("Hi {{fir", 8)).toEqual({
      start: 3,
      query: "fir",
    });
    expect(getOpenVariableToken("Hi Ada", 6)).toBeNull();
  });
});
