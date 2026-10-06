import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Message } from "@/types/chat";
import { createAttachments, NOT_KEPT } from "../attachments";
import type { Attachments, FileStore, StoredFile } from "../ports";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const PDF = "data:application/pdf;base64,JVBERi0=";

let kept: Map<string, string>;
let files: { load: Mock<FileStore["load"]>; store: Mock<FileStore["store"]> };
let attachments: Attachments;
const signal = new AbortController().signal;

beforeEach(() => {
  kept = new Map([
    ["img", PNG],
    ["pdf", PDF],
  ]);
  files = {
    load: vi.fn<FileStore["load"]>(async (file: StoredFile) =>
      kept.get(file.storageId ?? file.blossomHash ?? "")
    ),
    store: vi.fn<FileStore["store"]>(async () => ({ storageId: "new" })),
  };
  attachments = createAttachments(files);
});

const user = (content: Message["content"]): Message => ({
  role: "user",
  content,
});

describe("Attachments: what a request sends", () => {
  it("loads kept images and files, and sends only what the provider reads", async () => {
    const sent = await attachments.forRequest(
      [
        user([
          { type: "text", text: "two files", thinking: "x" },
          {
            type: "image_url",
            image_url: { url: "", storageId: "img", blossomHash: "h" },
          },
          {
            type: "file",
            file: {
              url: "",
              storageId: "pdf",
              name: "a.pdf",
              mimeType: "application/pdf",
              size: 5,
            },
          },
          { type: "text", text: "PDF attachment (a.pdf):\n\nhi", hidden: true },
        ]),
        { role: "assistant", content: "seen" },
      ],
      signal
    );

    expect(sent).toStrictEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "two files" },
          { type: "image_url", image_url: { url: PNG } },
          {
            type: "file",
            file: {
              url: PDF,
              name: "a.pdf",
              mimeType: "application/pdf",
              size: 5,
            },
          },
          { type: "text", text: "PDF attachment (a.pdf):\n\nhi" },
        ],
      },
      { role: "assistant", content: "seen" },
    ]);
    expect(files.load).toHaveBeenCalledWith(
      { url: "", storageId: "img", blossomHash: "h" },
      signal
    );
  });

  it("sends a file the message still carries as is, without loading it", async () => {
    const linked = "https://example.com/cat.png";
    const sent = await attachments.forRequest(
      [
        user([
          { type: "image_url", image_url: { url: PNG, storageId: "img" } },
          { type: "image_url", image_url: { url: linked } },
        ]),
      ],
      signal
    );

    expect(sent[0].content).toEqual([
      { type: "image_url", image_url: { url: PNG } },
      { type: "image_url", image_url: { url: linked } },
    ]);
    expect(files.load).not.toHaveBeenCalled();
  });

  it("leaves out a file no copy of can be reached", async () => {
    const sent = await attachments.forRequest(
      [
        user([
          { type: "text", text: "look" },
          { type: "image_url", image_url: { url: "", storageId: "gone" } },
        ]),
        user([{ type: "file", file: { url: "", storageId: "gone" } }]),
      ],
      signal
    );

    expect(sent.map((m) => m.content)).toEqual([
      [{ type: "text", text: "look" }],
      "",
    ]);
  });
});

describe("Attachments: what is saved", () => {
  it("keeps a reply's inline image and saves only where it is kept", async () => {
    files.store.mockResolvedValueOnce({
      storageId: "new",
      blossomHash: "h",
      blossomServers: ["https://b.example"],
    });
    const reply: Message = {
      role: "assistant",
      content: [
        { type: "text", text: "here" },
        { type: "image_url", image_url: { url: PNG } },
      ],
      _modelId: "m",
    };

    const saved = await attachments.forSave(reply, signal);

    expect(files.store).toHaveBeenCalledWith(PNG, signal);
    expect(saved).toStrictEqual({
      role: "assistant",
      content: [
        { type: "text", text: "here" },
        {
          type: "image_url",
          image_url: {
            url: "",
            storageId: "new",
            blossomHash: "h",
            blossomServers: ["https://b.example"],
          },
        },
      ],
      _modelId: "m",
    });
  });

  it("does not keep again a file the composer already kept", async () => {
    const saved = await attachments.forSave(
      user([
        {
          type: "file",
          file: {
            url: PDF,
            storageId: "pdf",
            name: "a.pdf",
            mimeType: "application/pdf",
            size: 5,
          },
        },
      ]),
      signal
    );

    expect(files.store).not.toHaveBeenCalled();
    expect(saved.content).toEqual([
      {
        type: "file",
        file: {
          url: "",
          storageId: "pdf",
          name: "a.pdf",
          mimeType: "application/pdf",
          size: 5,
        },
      },
    ]);
  });

  it("saves a file kept only on Blossom when this device is full", async () => {
    files.store.mockResolvedValueOnce({
      blossomHash: "h",
      blossomServers: ["b"],
    });
    const saved = await attachments.forSave(
      user([{ type: "image_url", image_url: { url: PNG } }]),
      signal
    );

    expect(saved.content).toEqual([
      {
        type: "image_url",
        image_url: { url: "", blossomHash: "h", blossomServers: ["b"] },
      },
    ]);
  });

  it("leaves out a file that could not be kept anywhere, and keeps the rest", async () => {
    files.store.mockResolvedValueOnce({});
    const saved = await attachments.forSave(
      user([
        { type: "text", text: "look" },
        { type: "image_url", image_url: { url: PNG } },
        { type: "image_url", image_url: { url: "", storageId: "img" } },
      ]),
      signal
    );

    expect(saved.content).toEqual([
      { type: "text", text: "look" },
      { type: "image_url", image_url: { url: "", storageId: "img" } },
    ]);
  });

  it("saves a note in place of a message whose only file could not be kept", async () => {
    files.store.mockResolvedValueOnce({});
    const saved = await attachments.forSave(
      user([{ type: "image_url", image_url: { url: PNG } }]),
      signal
    );

    expect(saved.content).toBe(NOT_KEPT);
  });

  it("saves a reply image that came without a url as it came", async () => {
    const broken = user([
      { type: "image_url", image_url: {} as { url: string } },
    ]);

    expect(await attachments.forSave(broken, signal)).toEqual(broken);
  });

  it("saves text and linked images unchanged", async () => {
    const linked = user([
      { type: "image_url", image_url: { url: "https://example.com/cat.png" } },
    ]);

    expect(await attachments.forSave(user("hello"), signal)).toEqual(
      user("hello")
    );
    expect(await attachments.forSave(linked, signal)).toEqual(linked);
    expect(files.store).not.toHaveBeenCalled();
  });
});
