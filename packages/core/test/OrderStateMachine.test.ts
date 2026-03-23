import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors/AppError.js";
import { assertOrderTransition } from "../src/services/OrderStateMachine.js";

describe("OrderStateMachine", () => {
  it("allows NEW -> PARTIALLY_FILLED -> FILLED", () => {
    expect(() => assertOrderTransition("NEW", "PARTIALLY_FILLED")).not.toThrow();
    expect(() => assertOrderTransition("PARTIALLY_FILLED", "FILLED")).not.toThrow();
  });

  it("rejects terminal transition from FILLED to CANCELED", () => {
    expect(() => assertOrderTransition("FILLED", "CANCELED")).toThrow(AppError);
  });
});
