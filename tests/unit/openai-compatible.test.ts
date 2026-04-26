import { describe, expect, it } from "vitest";
import {
  buildOpenAICompatibleApiUrl,
  getOpenAICompatibleClientOptions,
} from "@/lib/openai-compatible";

describe("openai-compatible", () => {
  describe("getOpenAICompatibleClientOptions", () => {
    it("returns api key only when no base URL is configured", () => {
      expect(getOpenAICompatibleClientOptions("sk-test")).toEqual({
        apiKey: "sk-test",
      });
    });

    it("trims and includes a custom base URL", () => {
      expect(
        getOpenAICompatibleClientOptions(
          "sk-test",
          " https://llm.example.com/v1 "
        )
      ).toEqual({
        apiKey: "sk-test",
        baseURL: "https://llm.example.com/v1",
      });
    });

    it("ignores blank custom base URLs", () => {
      expect(getOpenAICompatibleClientOptions("sk-test", "   ")).toEqual({
        apiKey: "sk-test",
      });
    });
  });

  describe("buildOpenAICompatibleApiUrl", () => {
    it("uses the OpenAI default base URL when unset", () => {
      expect(buildOpenAICompatibleApiUrl("chat/completions")).toBe(
        "https://api.openai.com/v1/chat/completions"
      );
    });

    it("appends paths to a custom compatible base URL", () => {
      expect(
        buildOpenAICompatibleApiUrl(
          "/chat/completions",
          "https://llm.example.com/v1/"
        )
      ).toBe("https://llm.example.com/v1/chat/completions");
    });
  });
});
