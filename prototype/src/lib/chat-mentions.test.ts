import { describe, expect, it } from "vitest";
import {
  activeMentionQuery,
  insertMentionToken,
  mentionHref,
  mentionToken,
  splitMentions,
} from "./chat-mentions";

describe("activeMentionQuery", () => {
  it("finds the @query right before the cursor", () => {
    expect(activeMentionQuery("hey @Ger", 8)).toEqual({ start: 4, query: "Ger" });
  });

  it("is null once a space breaks the run", () => {
    expect(activeMentionQuery("hey @Ger is", 11)).toBeNull();
  });

  it("is null with no @ at all", () => {
    expect(activeMentionQuery("hello there", 5)).toBeNull();
  });

  it("restarts at the most recent @", () => {
    expect(activeMentionQuery("@a @Ger", 7)).toEqual({ start: 3, query: "Ger" });
  });
});

describe("mentionToken / insertMentionToken", () => {
  it("builds a clean token even if the label carries brackets", () => {
    expect(mentionToken("assignment", "a1", "Week [1] Homework")).toBe("@[Week 1 Homework](assignment:a1) ");
  });

  it("replaces exactly the @query span and leaves the rest of the draft untouched", () => {
    const { value, cursor } = insertMentionToken("hey @Ger, how are you", 4, "Ger", "person", "u1", "Herr Gerald");
    expect(value).toBe("hey @[Herr Gerald](person:u1) , how are you");
    expect(value.slice(cursor)).toBe(", how are you");
  });
});

describe("splitMentions", () => {
  it("returns a single text segment for an ordinary message", () => {
    expect(splitMentions("just saying hi")).toEqual([{ kind: "text", text: "just saying hi" }]);
  });

  it("splits text and mentions in order", () => {
    const body = "see @[Class 16](assignment:a1) and @[Herr Gerald](person:u1) too";
    expect(splitMentions(body)).toEqual([
      { kind: "text", text: "see " },
      { kind: "mention", type: "assignment", id: "a1", label: "Class 16" },
      { kind: "text", text: " and " },
      { kind: "mention", type: "person", id: "u1", label: "Herr Gerald" },
      { kind: "text", text: " too" },
    ]);
  });

  it("ignores a malformed token (unknown type) as plain text", () => {
    const body = "@[Nope](unknown:x1) stays plain";
    expect(splitMentions(body)).toEqual([{ kind: "text", text: body }]);
  });
});

describe("mentionHref", () => {
  it("a person mention has no href — tagged, not linked", () => {
    expect(mentionHref("person", "u1")).toBeNull();
  });

  it("an assignment mention opens the assignment", () => {
    expect(mentionHref("assignment", "a1")).toBe("/assignment?id=a1");
  });

  it("a video mention opens the watch page", () => {
    expect(mentionHref("video", "v1")).toBe("/materials/watch/v1");
  });

  it("a material mention opens the documents tab at that card", () => {
    expect(mentionHref("material", "m1")).toBe("/materials?open=m1");
  });
});
