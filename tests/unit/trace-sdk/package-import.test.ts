import { traceSdkPackageName } from "@keeperhub/trace-sdk";
import "@keeperhub/trace-sdk/core";
import "@keeperhub/trace-sdk/react";
import "@keeperhub/trace-sdk/server";
import { describe, expect, it } from "vitest";

describe("trace SDK package bootstrap", () => {
  it("resolves the workspace package and subpath exports", () => {
    expect(traceSdkPackageName).toBe("@keeperhub/trace-sdk");
  });
});
