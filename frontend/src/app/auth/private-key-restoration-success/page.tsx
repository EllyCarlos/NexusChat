"use client";

import { Modal } from "@/components/modal/Modal";
import Link from "next/link";

export default function Page() {
  return (
    <Modal isOpen={true} onClose={() => ""}>
      <div className="flex flex-col gap-y-4">
        <h2 className="text-xl font-bold">Private Key Recovered Successfully</h2>
        <p>
          Your private key has been recovered successfully. It plays a vital role in:
        </p>
        <ul className="list-disc list-inside">
          <li>
            <strong>Encryption:</strong> Secures messages by ensuring only the intended recipient can read them.
          </li>
          <li>
            <strong>Decryption:</strong> Unlocks encrypted messages sent to you.
          </li>
          <li>
            <strong>Authentication:</strong> Verifies your identity during cryptographic operations.
          </li>
        </ul>
        <p>
          Keep your private key secure and never share it. Use a strong password to protect it. For help, contact support.
        </p>
        <Link href="/">
          <button className="bg-primary py-2 font-medium text-lg w-full hover:bg-primary-dark">
            Proceed to homepage
          </button>
        </Link>
      </div>
    </Modal>
  );
}
