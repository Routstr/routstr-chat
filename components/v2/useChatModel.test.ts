import { describe, expect, it } from "vitest";
import type { Model } from "@/types/models";
import { chatModelOf } from "./useChatModel";

const model = (inputs?: string[]) => ({ id: "m", name: "M", architecture: inputs ? { input_modalities: inputs } : undefined }) as unknown as Model;

describe("chatModelOf: what the engine is told about a model", () => {
  it("sends your pin while a provider still routes this model, in the route's own spelling", () => {
    const pinned = { id: "m", provider: "https://a.example/" };
    expect(chatModelOf(model(), pinned, [{ baseUrl: "https://a.example" }]).provider).toBe("https://a.example");
    expect(chatModelOf(model(), pinned, [{ baseUrl: "https://b.example/" }]).provider).toBeUndefined();
  });

  it("drops a pin made for another model", () => {
    expect(chatModelOf(model(), { id: "other", provider: "https://a.example/" }, [{ baseUrl: "https://a.example/" }]).provider).toBeUndefined();
  });

  it("says whether the model reads images, and leaves it open when nobody said", () => {
    expect(chatModelOf(model(["text"]), null, []).images).toBe(false);
    expect(chatModelOf(model(["text", "image"]), null, []).images).toBe(true);
    expect(chatModelOf(model(), null, []).images).toBeUndefined();
  });

  it("reads the provider's other spellings of image", () => {
    expect(chatModelOf(model(["text", "vision"]), null, []).images).toBe(true);
    expect(chatModelOf(model(["Image"]), null, []).images).toBe(true);
    expect(chatModelOf(model(["text", "images"]), null, []).images).toBe(true);
  });
});
