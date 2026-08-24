import { migrateOAuthPrivateKeyBackupToV2 } from "@/actions/auth.actions";
import { getUserPrivateKeyFromIndexedDB } from "@/lib/client/indexedDB";
import {
  encryptPrivateKeyV2,
  validateNexusChatPrivateJsonWebKey,
  validateNexusChatPublicJsonWebKey,
  type RecoveryKeyWrapV2,
} from "@/lib/client/privateKeyEnvelope";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";

type OAuthV2MigrationMaterial = {
  version: 2;
  recoverySecret: string;
  recoveryKeyWrap: RecoveryKeyWrapV2;
  publicKey: JsonWebKey;
};

export type OAuthPrivateKeyMigrationStatus =
  | "idle"
  | "checking"
  | "migrating"
  | "skipped"
  | "succeeded"
  | "failed";

type PropTypes = {
  userId: string | null | undefined;
  migration: OAuthV2MigrationMaterial | null | undefined;
  privateKey?: JsonWebKey;
};

export const useMigrateOAuthPrivateKeyBackupToV2 = ({
  userId,
  migration,
  privateKey: suppliedPrivateKey,
}: PropTypes) => {
  const [status, setStatus] = useState<OAuthPrivateKeyMigrationStatus>("idle");
  const [state, migrateAction] = useActionState(
    migrateOAuthPrivateKeyBackupToV2,
    undefined
  );
  const migrationStartedRef = useRef(false);

  useEffect(() => {
    if (migrationStartedRef.current || !userId || !migration) {
      return;
    }

    migrationStartedRef.current = true;
    setStatus("checking");

    void (async () => {
      try {
        const storedPrivateKey =
          suppliedPrivateKey ??
          (await getUserPrivateKeyFromIndexedDB({ userId }));
        if (!storedPrivateKey) {
          setStatus("skipped");
          return;
        }

        const [privateKey, publicKey] = await Promise.all([
          validateNexusChatPrivateJsonWebKey(storedPrivateKey),
          validateNexusChatPublicJsonWebKey(migration.publicKey),
        ]);

        if (
          privateKey.kty !== publicKey.kty ||
          privateKey.crv !== publicKey.crv ||
          privateKey.x !== publicKey.x ||
          privateKey.y !== publicKey.y
        ) {
          setStatus("failed");
          return;
        }

        const encryptedPrivateKey = await encryptPrivateKeyV2({
          privateKey: storedPrivateKey,
          recoverySecret: migration.recoverySecret,
          recoveryKeyWrap: migration.recoveryKeyWrap,
        });

        setStatus("migrating");
        startTransition(() => {
          migrateAction({ privateKey: encryptedPrivateKey });
        });
      } catch {
        setStatus("failed");
      }
    })();
  }, [migration, migrateAction, suppliedPrivateKey, userId]);

  useEffect(() => {
    if (state?.errors?.message) {
      setStatus("failed");
    } else if (state?.data?.migrated) {
      setStatus("succeeded");
    }
  }, [state]);

  return { status };
};
