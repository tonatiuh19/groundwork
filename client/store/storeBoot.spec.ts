import { describe, expect, it } from "vitest";
import { store } from "@/store";

/** Every slice builds its reducer on the first action; a duplicate handler throws and blanks the whole app. */
describe("app store", () => {
  it("boots: every slice's reducer builds without errors", () => {
    expect(() => store.dispatch({ type: "test/boot" })).not.toThrow();
    expect(Object.keys(store.getState()).length).toBeGreaterThan(10);
  });
});
