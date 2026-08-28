import type { RequestHandler } from "express";
import { describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => {
  const validationCalls: Array<{
    schema: unknown;
    handler: ReturnType<typeof vi.fn>;
  }> = [];
  const validate = vi.fn((schema: unknown) => {
    const handler = vi.fn();
    validationCalls.push({ schema, handler });
    return handler;
  });

  return {
    addMemberToChat: vi.fn(),
    avatarUploadRateLimit: vi.fn(),
    authorizeGroupChatUpload: vi.fn(),
    createChat: vi.fn(),
    createChatUploadHandler: vi.fn(),
    createChatUploadSingle: vi.fn(),
    fileValidation: vi.fn(),
    getUserChats: vi.fn(),
    groupChatUploadHandler: vi.fn(),
    groupChatUploadSingle: vi.fn(),
    removeMemberFromChat: vi.fn(),
    updateChat: vi.fn(),
    uploadCleanupBoundary: vi.fn(),
    validate,
    validationCalls,
    verifyToken: vi.fn(),
  };
});

vi.mock("../src/controllers/chat.controller.js", () => ({
  addMemberToChat: routeMocks.addMemberToChat,
  createChat: routeMocks.createChat,
  getUserChats: routeMocks.getUserChats,
  removeMemberFromChat: routeMocks.removeMemberFromChat,
  updateChat: routeMocks.updateChat,
}));

vi.mock("../src/middlewares/verify-token.middleware.js", () => ({
  verifyToken: routeMocks.verifyToken,
}));

vi.mock("../src/middlewares/rate-limit.middleware.js", () => ({
  avatarUploadRateLimit: routeMocks.avatarUploadRateLimit,
}));

vi.mock("../src/middlewares/upload-authorization.middleware.js", () => ({
  authorizeGroupChatUpload: routeMocks.authorizeGroupChatUpload,
}));

vi.mock("../src/utils/upload-lifecycle.util.js", () => ({
  uploadCleanupBoundary: routeMocks.uploadCleanupBoundary,
}));

vi.mock("../src/middlewares/multer.middleware.js", () => ({
  createChatUpload: {
    single: routeMocks.createChatUploadSingle.mockReturnValue(
      routeMocks.createChatUploadHandler,
    ),
  },
  groupChatUpload: {
    single: routeMocks.groupChatUploadSingle.mockReturnValue(
      routeMocks.groupChatUploadHandler,
    ),
  },
}));

vi.mock("../src/middlewares/file-validation.middleware.js", () => ({
  fileValidation: routeMocks.fileValidation,
}));

vi.mock("../src/middlewares/validate.middleware.js", () => ({
  validate: routeMocks.validate,
}));

import {
  addMemberToChatSchema,
  createChatSchema,
  removeMemberfromChat,
  updateChatSchema,
} from "../src/schemas/chat.schema.js";
import chatRouter from "../src/routes/chat.router.js";

type RouteMethod = "delete" | "patch" | "post";

type RouterLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
};

const routeLayers = () => (
  chatRouter as unknown as { stack: RouterLayer[] }
).stack.filter((layer): layer is Required<Pick<RouterLayer, "route">> => Boolean(layer.route));

const mutationRoute = (method: RouteMethod, path: string) => {
  const layer = routeLayers().find(({ route }) => (
    route.path === path && route.methods[method]
  ));
  expect(layer, `${method.toUpperCase()} ${path} route`).toBeDefined();
  expect(Object.keys(layer?.route.methods ?? {})).toEqual([method]);
  return layer?.route.stack.map(({ handle }) => handle) ?? [];
};

const validationHandlerFor = (schema: unknown): RequestHandler => {
  const call = routeMocks.validationCalls.find((entry) => entry.schema === schema);
  expect(call, "schema validation middleware").toBeDefined();
  return call?.handler as RequestHandler;
};

describe("chat mutation route characterization", () => {
  it("keeps the exact mutation method and path inventory", () => {
    const mutationInventory = routeLayers()
      .flatMap(({ route }) => Object.keys(route.methods)
        .filter((method): method is RouteMethod => (
          method === "delete" || method === "patch" || method === "post"
        ))
        .map((method) => ({ method, path: route.path })));

    expect(mutationInventory).toEqual([
      { method: "post", path: "/" },
      { method: "patch", path: "/:id/members" },
      { method: "patch", path: "/:id" },
      { method: "delete", path: "/:id/members" },
    ]);
  });

  it("binds both avatar upload middlewares to the exact avatar field and preserves schema identity", () => {
    expect(routeMocks.createChatUploadSingle).toHaveBeenCalledOnce();
    expect(routeMocks.createChatUploadSingle).toHaveBeenCalledWith("avatar");
    expect(routeMocks.groupChatUploadSingle).toHaveBeenCalledOnce();
    expect(routeMocks.groupChatUploadSingle).toHaveBeenCalledWith("avatar");
    expect(routeMocks.validate.mock.calls).toEqual([
      [createChatSchema],
      [addMemberToChatSchema],
      [updateChatSchema],
      [removeMemberfromChat],
    ]);
  });

  it("keeps POST / authenticated, rate limited, cleanup protected, validated, and controller terminated", () => {
    expect(mutationRoute("post", "/")).toEqual([
      routeMocks.verifyToken,
      routeMocks.avatarUploadRateLimit,
      routeMocks.uploadCleanupBoundary,
      routeMocks.createChatUploadHandler,
      routeMocks.fileValidation,
      validationHandlerFor(createChatSchema),
      routeMocks.createChat,
    ]);
  });

  it("keeps PATCH /:id/members authenticated and validated before adding members", () => {
    expect(mutationRoute("patch", "/:id/members")).toEqual([
      routeMocks.verifyToken,
      validationHandlerFor(addMemberToChatSchema),
      routeMocks.addMemberToChat,
    ]);
  });

  it("keeps PATCH /:id authorization ahead of upload processing and exact update middleware order", () => {
    expect(mutationRoute("patch", "/:id")).toEqual([
      routeMocks.verifyToken,
      routeMocks.avatarUploadRateLimit,
      routeMocks.authorizeGroupChatUpload,
      routeMocks.uploadCleanupBoundary,
      routeMocks.groupChatUploadHandler,
      routeMocks.fileValidation,
      validationHandlerFor(updateChatSchema),
      routeMocks.updateChat,
    ]);
  });

  it("keeps DELETE /:id/members authenticated and validated before removing members", () => {
    expect(mutationRoute("delete", "/:id/members")).toEqual([
      routeMocks.verifyToken,
      validationHandlerFor(removeMemberfromChat),
      routeMocks.removeMemberFromChat,
    ]);
  });
});
