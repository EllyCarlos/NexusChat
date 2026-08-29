import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EmailDeliveryMessage,
  EmailDeliveryProvider,
} from "../src/modules/notifications/contracts/email-delivery.provider.js";

const mocks = vi.hoisted(() => ({
  getEmailTransporter: vi.fn(),
  sendMail: vi.fn(async (_message: Record<string, unknown>): Promise<unknown> => undefined),
}));

vi.mock("../src/config/nodemailer.config.js", () => ({
  getEmailTransporter: mocks.getEmailTransporter,
}));

import { createEmailDeliverer } from "../src/modules/notifications/application/deliver-email.js";
import { deliverEmail } from "../src/modules/notifications/email-delivery.service.js";
import { nodemailerEmailDeliveryProvider } from "../src/modules/notifications/infrastructure/nodemailer-email-delivery.provider.js";

const message: EmailDeliveryMessage = {
  from: "sender@example.test",
  to: "recipient@example.test",
  subject: "NexusChat notification",
  html: "<p>Rendered NexusChat email</p>",
};

describe("email delivery application", () => {
  it("delegates the exact provider-neutral message", async () => {
    const providerDeliver = vi.fn(async (_message: EmailDeliveryMessage): Promise<void> => undefined);
    const provider: EmailDeliveryProvider = { deliver: providerDeliver };
    const deliver = createEmailDeliverer({ emailDeliveryProvider: provider });

    await expect(deliver(message)).resolves.toBeUndefined();

    expect(providerDeliver).toHaveBeenCalledOnce();
    expect(providerDeliver).toHaveBeenCalledWith(message);
  });

  it("waits for provider delivery before completing", async () => {
    let resolveProvider!: () => void;
    const providerDelivery = new Promise<void>((resolve) => {
      resolveProvider = resolve;
    });
    const providerDeliver = vi.fn((_message: EmailDeliveryMessage) => providerDelivery);
    const deliver = createEmailDeliverer({
      emailDeliveryProvider: { deliver: providerDeliver },
    });

    const delivery = deliver(message);
    let settled = false;
    void delivery.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    resolveProvider();
    await expect(delivery).resolves.toBeUndefined();
    expect(settled).toBe(true);
  });

  it("propagates provider rejection unchanged", async () => {
    const providerError = new Error("email delivery failed");
    const deliver = createEmailDeliverer({
      emailDeliveryProvider: {
        deliver: vi.fn(async () => {
          throw providerError;
        }),
      },
    });

    await expect(deliver(message)).rejects.toBe(providerError);
  });
});

describe("Nodemailer email delivery adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEmailTransporter.mockReturnValue({ sendMail: mocks.sendMail });
    mocks.sendMail.mockResolvedValue(undefined);
  });

  it("does not acquire or invoke the transport during composition", () => {
    expect(deliverEmail).toBeTypeOf("function");
    expect(mocks.getEmailTransporter).not.toHaveBeenCalled();
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("forwards the exact message, awaits Nodemailer, and suppresses its response", async () => {
    let resolveProvider!: (value: unknown) => void;
    const providerDelivery = new Promise<unknown>((resolve) => {
      resolveProvider = resolve;
    });
    mocks.sendMail.mockReturnValueOnce(providerDelivery);

    const delivery = nodemailerEmailDeliveryProvider.deliver(message);
    let settled = false;
    void delivery.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(mocks.getEmailTransporter).toHaveBeenCalledOnce();
    expect(mocks.sendMail).toHaveBeenCalledOnce();
    expect(mocks.sendMail).toHaveBeenCalledWith(message);
    expect(settled).toBe(false);

    resolveProvider({ messageId: "provider-response" });
    await expect(delivery).resolves.toBeUndefined();
    expect(settled).toBe(true);
  });

  it("propagates synchronous transporter access failures", async () => {
    const providerError = new Error("transporter unavailable");
    mocks.getEmailTransporter.mockImplementationOnce(() => {
      throw providerError;
    });

    await expect(nodemailerEmailDeliveryProvider.deliver(message)).rejects.toBe(providerError);
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("propagates synchronous Nodemailer send failures", async () => {
    const providerError = new Error("Nodemailer threw during delivery");
    mocks.sendMail.mockImplementationOnce(() => {
      throw providerError;
    });

    await expect(nodemailerEmailDeliveryProvider.deliver(message)).rejects.toBe(providerError);
  });

  it("propagates asynchronous Nodemailer rejection", async () => {
    const providerError = new Error("Nodemailer rejected delivery");
    mocks.sendMail.mockRejectedValueOnce(providerError);

    await expect(nodemailerEmailDeliveryProvider.deliver(message)).rejects.toBe(providerError);
  });

  it("the root service composes the concrete adapter", async () => {
    await expect(deliverEmail(message)).resolves.toBeUndefined();

    expect(mocks.getEmailTransporter).toHaveBeenCalledOnce();
    expect(mocks.sendMail).toHaveBeenCalledOnce();
    expect(mocks.sendMail).toHaveBeenCalledWith(message);
  });
});
