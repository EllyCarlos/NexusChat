import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Provider } from "react-redux";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<unknown>) => {
    const label = loader.toString().includes("RecoverPrivateKeyForm")
      ? "recovery-form"
      : "other-form";
    return () => label;
  },
}));

vi.mock("../src/components/modal/Modal", async () => {
  const { createElement: createMockElement } = await import("react");
  return {
    Modal: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) =>
      isOpen
        ? createMockElement("section", { "data-modal": "open" }, children)
        : null,
  };
});

import { performClientLogout } from "../src/hooks/useAuth/useLogout";
import { ModalWrapper } from "../src/components/modal/ModalWrapper";
import { updateLoggedInUser } from "../src/lib/client/slices/authSlice";
import { setRecoverPrivateKeyForm } from "../src/lib/client/slices/uiSlice";
import { makeStore } from "../src/lib/client/store/store";
import type { FetchUserInfoResponse } from "../src/lib/server/services/userService";

const AUTHENTICATED_USER: FetchUserInfoResponse = {
  id: "user-a",
  name: "User A",
  username: "user-a",
  avatar: "https://example.test/avatar.png",
  email: "user-a@example.test",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  emailVerified: true,
  publicKey: null,
  needsKeyRecovery: true,
  notificationsEnabled: true,
  verificationBadge: false,
  fcmToken: null,
  oAuthSignup: false,
  isOnline: true,
  lastSeen: null,
};

const renderModalWrapper = (store: ReturnType<typeof makeStore>) =>
  renderToStaticMarkup(
    <Provider store={store}>
      <ModalWrapper />
    </Provider>,
  );

describe("ModalWrapper authentication guard", () => {
  it("does not render recovery UI for a logged-out store with a stale open flag", () => {
    const store = makeStore();
    store.dispatch(setRecoverPrivateKeyForm(true));

    expect(renderModalWrapper(store)).toBe("");
  });

  it("renders recovery UI for an authenticated store with the flag open", () => {
    const store = makeStore();
    store.dispatch(updateLoggedInUser(AUTHENTICATED_USER));
    store.dispatch(setRecoverPrivateKeyForm(true));

    const markup = renderModalWrapper(store);

    expect(markup).toContain('data-modal="open"');
    expect(markup).toContain("recovery-form");
  });

  it("removes the recovery flag during a successful logout reset", async () => {
    const store = makeStore();
    store.dispatch(updateLoggedInUser(AUTHENTICATED_USER));
    store.dispatch(setRecoverPrivateKeyForm(true));

    await performClientLogout({
      logoutOnServer: vi.fn().mockResolvedValue(undefined),
      dispatch: store.dispatch,
      getState: store.getState,
      router: { replace: vi.fn(), refresh: vi.fn() },
      storage: {
        localStorage: { removeItem: vi.fn() },
        sessionStorage: { removeItem: vi.fn() },
      },
    });

    expect(store.getState().uiSlice.recoverPrivateKeyForm).toBe(false);
    expect(renderModalWrapper(store)).toBe("");
  });
});
