import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import { api } from "@/lib/api";
import { store } from "@/store";
import { PHOTO_ACCEPT, PHOTO_MAX_BYTES, PhotoForm } from "./ContractorForms";

const user = userEvent.setup({ applyAccept: false });

function mount(onDone = vi.fn()) {
  render(
    <Provider store={store}>
      <MemoryRouter>
        <PhotoForm projects={[]} fixedProject="GW-TEST0001" onDone={onDone} />
      </MemoryRouter>
    </Provider>,
  );
  return onDone;
}

const picker = () => screen.getByLabelText(i18n.t("ctr.photoFile")) as HTMLInputElement;
const submit = () => user.click(screen.getByRole("button", { name: i18n.t("ctr.addPhoto") }));

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PhotoForm (binary upload)", () => {
  it("only offers image types and requires a file", async () => {
    const post = vi.spyOn(api, "post");
    mount();
    expect(picker()).toHaveAttribute("accept", PHOTO_ACCEPT);
    await submit();
    expect(await screen.findByText(i18n.t("validation.photoFile"))).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("rejects non-image files client-side", async () => {
    const post = vi.spyOn(api, "post");
    mount();
    await user.upload(picker(), new File(["hello"], "notes.txt", { type: "text/plain" }));
    await submit();
    expect(await screen.findByText(i18n.t("validation.photoFile"))).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("rejects photos over the 4 MB API limit before uploading", async () => {
    const post = vi.spyOn(api, "post");
    mount();
    const big = new File([new Uint8Array(8)], "big.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: PHOTO_MAX_BYTES + 1 });
    await user.upload(picker(), big);
    await submit();
    expect(await screen.findByText(i18n.t("validation.photoTooLarge"))).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("uploads raw bytes with the real content type, caption as query, no serializability warnings", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: { ok: true, id: 1 } } as any);
    const onDone = mount();
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], "slab.jpg", { type: "image/jpeg" });
    await user.upload(picker(), file);
    await user.type(screen.getByLabelText(i18n.t("ctr.caption")), "Slab poured");
    await submit();
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, config] = post.mock.calls[0] as [string, File, any];
    expect(url).toBe("/contractor/projects/GW-TEST0001/photos/upload");
    expect(body).toBe(file);
    expect(config.headers).toEqual({ "Content-Type": "image/jpeg" });
    expect(config.params).toEqual({ caption: "Slab poured" });
    // the File passes through the thunk arg without tripping RTK's serializable check
    expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/non-serializable/i);
    // the form resets after success
    await waitFor(() => expect(picker().value).toBe(""));
  });

  it("shows translated server errors (storage not configured) and keeps the form usable", async () => {
    vi.spyOn(api, "post").mockRejectedValue(
      new AxiosError("fail", "ERR_BAD_RESPONSE", undefined, undefined, {
        status: 503,
        data: { error: "errors.storageNotConfigured" },
      } as any),
    );
    const onDone = mount();
    await user.upload(picker(), new File([new Uint8Array([0x89, 0x50])], "a.png", { type: "image/png" }));
    await submit();
    expect(await screen.findByText(i18n.t("errors.storageNotConfigured"))).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: i18n.t("ctr.addPhoto") })).toBeEnabled();
  });
});
