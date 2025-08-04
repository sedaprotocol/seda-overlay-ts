import { describe, it, expect } from "bun:test";
import { SizedSet } from "./sized-set";

describe("SizedSet", () => {
  describe("add method - size limiting logic", () => {
    it("should add items when under max size", () => {
      const sizedSet = new SizedSet<string>(3);
      
      sizedSet.add("item1");
      expect(sizedSet.size).toBe(1);
      expect(sizedSet.has("item1")).toBe(true);
      
      sizedSet.add("item2");
      expect(sizedSet.size).toBe(2);
      expect(sizedSet.has("item2")).toBe(true);
    });

    it("should remove oldest items when adding multiple items that exceed max size", () => {
      const sizedSet = new SizedSet<string>(3);
      
      sizedSet.add("item1");
      sizedSet.add("item2");
      sizedSet.add("item3");
      sizedSet.add("item4");
      sizedSet.add("item5");
      
      expect(sizedSet.size).toBe(3);
      expect(sizedSet.has("item1")).toBe(false);
      expect(sizedSet.has("item2")).toBe(false);
      expect(sizedSet.has("item3")).toBe(true);
      expect(sizedSet.has("item4")).toBe(true);
      expect(sizedSet.has("item5")).toBe(true);
    });
  });
});
