import { base64ToUint8Array, uint8ArrayToBase64 } from "../shared/helpers";

// key pair generation
const generateKeyPair = async () => {
  if (typeof window === "undefined") return;
  const crypto = window.crypto.subtle;

  // The `async` function allows the use of `await` inside it.
  // We are awaiting the result of the `crypto.generateKey` function which is a promise-based method.

  const keyPair = await crypto.generateKey(
    {
      // Specifies the algorithm to be used for key pair generation.
      name: "ECDH", // Elliptic Curve Diffie-Hellman (ECDH) is a key exchange algorithm that allows two parties to securely share a secret key over an insecure channel.

      // Defines the elliptic curve to be used in the ECDH algorithm.
      // "P-384" is a recommended elliptic curve with a 384-bit key size, providing a good balance of security and performance.
      namedCurve: "P-384", // This determines which elliptic curve is used for key generation.
    },
    true, // The `extractable` flag determines whether the generated key can be exported.
    // If `true`, you can export the key later (for example, to send it to another party or save it locally).
    // If `false`, the key can only be used within the current context (e.g., within the browser).

    // The keyUsages defines what the key is used for. The array here indicates that this key will be used for `deriveKey`.
    // `deriveKey` means that this key will be used for deriving shared secret keys in ECDH key exchange.
    ["deriveKey"]
  );
  return keyPair;
};
// message encryption function
const encryptMessage = async ({
  sharedKey,
  message,
}: {
  sharedKey: CryptoKey;
  message: string;
}): Promise<string | null> => {
  if (typeof window === "undefined") return "";
  const crypto = window.crypto.subtle;
  // Generate a random initialization vector (IV) for each encryption. AES-GCM requires a unique IV for every encryption operation.
  // This ensures the same message encrypted multiple times will produce different ciphertexts.
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // AES-GCM typically uses a 12-byte IV.

  // Convert the message to a Uint8Array for encryption. This is the format expected by the crypto API.
  // The `TextEncoder` encodes the string message into a sequence of bytes (Uint8Array).
  const encoded = new TextEncoder().encode(message); // Message is now in a binary form.

  // Encrypt the message using the AES-GCM algorithm with the shared key and the generated IV.
  // `crypto.encrypt` takes an encryption configuration (which includes the algorithm name and IV) and applies it to the shared key and the message data.
  const encryptedData = await crypto.encrypt(
    { name: "AES-GCM", iv: iv }, // Specify the AES-GCM encryption with the IV.
    sharedKey, // The shared key used for encryption.
    encoded // The message data that needs to be encrypted.
  );

  // Combine the IV and the encrypted data into one ArrayBuffer for easy transmission.
  // AES-GCM outputs encrypted data, but we need to send the IV along with it so the decryption process knows the IV to use.
  const combinedBuffer = new Uint8Array(iv.length + encryptedData.byteLength); // Prepare a new buffer to hold both the IV and the encrypted data.
  combinedBuffer.set(iv, 0); // Set the IV in the beginning of the buffer.
  combinedBuffer.set(new Uint8Array(encryptedData), iv.length); // Append the encrypted data after the IV.

  // Convert the combined buffer into a base64 string for safe transmission as text.
  // The combined data is now encoded in base64 format.
  const base64Payload = uint8ArrayToBase64(combinedBuffer); // Helper function that converts the array buffer to base64.

  // Return the encrypted message as a base64 string which can be transmitted safely.
  if(base64Payload){
    return base64Payload;
  }
  return null;
};

const encryptAudioBlob = async ({
  sharedKey,
  audioBlob,
}: {
  sharedKey: CryptoKey;
  audioBlob: Blob;
}): Promise<Uint8Array<ArrayBuffer> | undefined> => {
  if (typeof window === "undefined") return;
  const crypto = window.crypto.subtle;

  // Convert Blob to ArrayBuffer
  const audioArrayBuffer = await audioBlob.arrayBuffer();

  // Generate a random IV
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  // Encrypt the audio data
  const encryptedData = await crypto.encrypt(
    { name: "AES-GCM", iv },
    sharedKey,
    audioArrayBuffer
  );

  // Combine IV and encrypted data
  const combinedBuffer = new Uint8Array(iv.length + encryptedData.byteLength);
  combinedBuffer.set(iv, 0);
  combinedBuffer.set(new Uint8Array(encryptedData), iv.length);

  return combinedBuffer;
};


// message decryption function
const decryptMessage = async (
  sharedKey: CryptoKey,
  encryptedDataWithIv: string
) => {
  try {
    if (typeof window === "undefined") return;
    const crypto = window.crypto.subtle;
  
    // Convert the base64-encoded encrypted data (which includes both the IV and the ciphertext) back to a Uint8Array.
    // The helper function `base64ToUint8Array` decodes the base64 string into a binary array (Uint8Array).
    const encryptedDataWithIvUint8Array = base64ToUint8Array(encryptedDataWithIv);
  
    if(!encryptedDataWithIvUint8Array) return;
  
    // Extract the IV (Initialization Vector) from the encrypted data.
    // AES-GCM typically uses a 12-byte IV, which is extracted from the first 12 bytes of the combined data.
    const iv = encryptedDataWithIvUint8Array.slice(0, 12); // Slice the first 12 bytes for the IV.
  
    // Extract the actual encrypted message (ciphertext), which follows the IV in the combined data.
    const encryptedMessage = encryptedDataWithIvUint8Array.slice(12); // The remaining bytes are the encrypted message.
  
    try {
      // Decrypt the encrypted message using the AES-GCM algorithm with the provided shared key and the extracted IV.
      // The `crypto.decrypt` method is used to decrypt the encrypted message with the specified configuration.
      const decryptedArrayBuffer = await crypto.decrypt(
        { name: "AES-GCM", iv }, // Specify the AES-GCM algorithm with the IV used for encryption.
        sharedKey, // The shared key that was used during encryption.
        encryptedMessage // The actual encrypted message (ciphertext) to be decrypted.
      );
  
      // Convert the decrypted data (ArrayBuffer) back into a readable string using TextDecoder.
      // The `TextDecoder().decode()` method converts the decrypted ArrayBuffer into a text string.
      const decryptedMessage = new TextDecoder().decode(decryptedArrayBuffer);
  
      // Return the decrypted message as a string.
      return decryptedMessage;
    } catch {
      // console.log(error);
      // If decryption fails (e.g., due to incorrect key or corrupted data), handle the error.
      // Here, instead of logging the error, the function returns `null` to indicate decryption failure.
      return null;
    }
  } catch {
    // console.log('error at decryptMessage',error);
  }
};

const decryptAudioBlob = async ({
  sharedKey,
  encryptedAudio,
}: {
  sharedKey: CryptoKey;
  encryptedAudio: Uint8Array<ArrayBuffer>;
}): Promise<Blob | null> => {
  if (typeof window === "undefined") return null;
  const crypto = window.crypto.subtle;

  try {
    // Extract IV and encrypted data
    const iv = encryptedAudio.slice(0, 12);
    const audioEncrypted = encryptedAudio.slice(12);

    // Decrypt the message
    const decryptedArrayBuffer = await crypto.decrypt(
      { name: "AES-GCM", iv },
      sharedKey,
      audioEncrypted
    );

    // Convert decrypted ArrayBuffer back to a Blob
    return new Blob([decryptedArrayBuffer], { type: "audio/webm" }); // Change type based on actual format
  } catch (error) {
    console.error("Decryption failed:", error);
    return null;
  }
};


// Function to derive a shared secret key using ECDH and the provided private and public keys
const deriveSharedSecretKey = async ({
  privateKey,
  publicKey,
}: {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}) => {
  if (typeof window === "undefined") return;
  const crypto = window.crypto.subtle;

  const sharedSecretKey = await crypto.deriveKey(
    {
      name: "ECDH", // Key exchange algorithm: Elliptic Curve Diffie-Hellman (ECDH)
      public: publicKey, // The public key of the other party in the exchange
    },
    privateKey, // The private key of the local party
    {
      name: "AES-GCM", // The algorithm that will use the derived shared key: AES-GCM
      length: 256, // The length of the derived key (in bits)
    },
    true, // The derived key will be exportable
    ["encrypt", "decrypt"] // The derived key will be used for encryption and decryption
  );

  return sharedSecretKey;
};

// Function to derive a key from password using PBKDF2
const deriveKeyFromPassword = async (password: string, salt: Uint8Array) => {
  if (typeof window === "undefined") return;
  const crypto = window.crypto.subtle;

  try {
    // Step 1: Create a TextEncoder to convert the password string into a byte array
    // The TextEncoder converts the password (a string) into a Uint8Array which is the format needed for cryptographic operations.
    const passwordBuffer = new TextEncoder().encode(password);

    // Step 2: Import the password as cryptographic key material
    // We import the password as raw key material that can be used for key derivation.
    const keyMaterial = await crypto.importKey(
      "raw", // The format of the key (raw means no special encoding)
      passwordBuffer, // The encoded password in byte format
      { name: "PBKDF2" }, // Specify the algorithm we're using (PBKDF2 for key derivation)
      false, // The key is not extractable, meaning it cannot be retrieved from the browser's cryptographic module
      ["deriveBits", "deriveKey"] // Specify the operations allowed for the key (deriving bits or keys)
    );

    // Step 3: Derive a key from the key material using PBKDF2 with the provided salt
    // PBKDF2 is a secure key derivation function that transforms the password (key material) into a key.
    const key = await window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2", // Specify the key derivation algorithm
        salt: salt, // The salt is a random value added to the password to prevent rainbow table attacks
        iterations: 100000, // Set the number of iterations (100,000 makes it computationally expensive to brute-force)
        hash: "SHA-256", // Specify the hash function (SHA-256 is used for secure key derivation)
      },
      keyMaterial, // The material we imported earlier (password transformed to a key)
      { name: "AES-GCM", length: 256 }, // Output the key for AES-GCM with a 256-bit length (used for encryption/decryption)
      true, // The key is **extractable**, meaning it can be used by the browser's crypto module
      ["encrypt", "decrypt"] // The key will be used for both encryption and decryption
    );

    // Step 4: Return the derived key
    // Once the key is derived, it can be used to encrypt and decrypt messages.
    return key;
  } catch (error) {
    // Step 5: Handle any errors that might occur during key derivation
    // If something goes wrong, log the error and rethrow it for further handling.
    console.error("Error generating key:", error);
    throw error; // Rethrow the error to be handled by the caller
  }
};

const encryptPrivateKey = async (password: string, privateKey: JsonWebKey) => {
  if (typeof window === "undefined") return;

  // Step 1: Generate a random salt of 16 bytes for PBKDF2
  // A salt is generated for key derivation to ensure the security of the password-based encryption.
  // The salt is a random value that ensures the derived key will be unique even if the same password is used.
  const salt = window.crypto.getRandomValues(new Uint8Array(16));

  // Step 2: Derive an encryption key from the password and salt using PBKDF2
  // We use the password and the generated salt to derive a key using the PBKDF2 key derivation function.
  // This results in a secure encryption key that will be used to encrypt the private key.
  const key = await deriveKeyFromPassword(password, salt);

  if (!key) return;

  // Step 3: Encode the private key to a JSON string and then to a byte array
  // The private key (in the form of a JsonWebKey) is converted to a string using JSON.stringify,
  // and then encoded into a Uint8Array (byte array) because the Web Crypto API requires data to be in this format.
  const dataBuffer = new TextEncoder().encode(JSON.stringify(privateKey));

  // Step 4: Generate a random initialization vector (IV) of 12 bytes for AES-GCM
  // AES-GCM (Galois/Counter Mode) requires an initialization vector (IV) to provide additional randomness
  // for the encryption process. The IV is generated randomly and is unique for each encryption operation.
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  // Step 5: Encrypt the data using AES-GCM with the derived key and IV
  // The private key (now in a byte array format) is encrypted using the derived key and the generated IV.
  // The AES-GCM mode is a widely used encryption algorithm that provides both confidentiality and integrity.
  const encryptedData = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv }, // The encryption algorithm and IV used
    key, // The derived encryption key from password
    dataBuffer // The private key data to be encrypted
  );

  // Step 6: Combine the salt, IV, and the encrypted data into one ArrayBuffer
  // Once the data is encrypted, we need to store the salt, IV, and the encrypted private key together
  // to allow decryption later. The combined buffer will be stored in the database.
  const combinedBuffer = new Uint8Array(
    salt.length + iv.length + encryptedData.byteLength
  );

  // Set the salt at the beginning of the buffer
  combinedBuffer.set(salt, 0);

  // Set the IV after the salt
  combinedBuffer.set(iv, salt.length);

  // Set the encrypted data after the IV
  combinedBuffer.set(new Uint8Array(encryptedData), salt.length + iv.length);

  // Step 7: Convert the combined buffer to Base64 for storage
  // Base64 encoding is used to make the combined buffer suitable for storage or transmission as a string.
  // This allows the encrypted data, IV, and salt to be stored in a database or sent over a network.
  const combinedBufferBase64 = uint8ArrayToBase64(combinedBuffer);

  // Step 8: Return the Base64-encoded combined buffer
  // The final result is the Base64-encoded combined buffer, which can be securely stored and retrieved.
  return combinedBufferBase64;
};

// Function to decrypt a Base64-encoded encrypted private key using a password
const decryptPrivateKey = async (
  password: string,
  combinedBufferBase64: string
) => {
  if (typeof window === "undefined") return;

  // Step 1: Convert the Base64-encoded combined buffer back to a Uint8Array
  // `atob` decodes the Base64 string to a binary string, and `Uint8Array.from` converts each character
  // of the binary string to its corresponding char code (byte value) to create the Uint8Array.
  const combinedBuffer = Uint8Array.from(atob(combinedBufferBase64), (c) =>
    c.charCodeAt(0)
  );

  // Step 2: Extract the salt (first 16 bytes), IV (next 12 bytes), and the encrypted message
  // The combined buffer is structured as follows:
  // [Salt (16 bytes)][IV (12 bytes)][Encrypted Message (remaining bytes)]
  const salt = combinedBuffer.slice(0, 16); // First 16 bytes are the salt
  const iv = combinedBuffer.slice(16, 28); // Next 12 bytes are the IV (16 + 12 = 28)
  const encryptedMessage = combinedBuffer.slice(28); // Remaining bytes are the encrypted data

  // Step 3: Derive the encryption key from the password and extracted salt
  // The `deriveKeyFromPassword` function is used to generate a cryptographic key using the password and salt.
  // This ensures that the correct password and salt are required to decrypt the data.
  const key = await deriveKeyFromPassword(password, salt);
  if (!key) return;

  try {
    // Step 4: Decrypt the encrypted message using AES-GCM with the derived key and IV
    // `window.crypto.subtle.decrypt` performs the decryption process.
    // If the password, salt, or IV is incorrect, or if the encrypted data is tampered with, this will throw an error.
    const decryptedArrayBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv }, // Decryption algorithm and the extracted IV
      key, // Derived key
      encryptedMessage // The encrypted data to decrypt
    );

    // Step 5: Decode the decrypted ArrayBuffer back to a string
    // The decrypted ArrayBuffer is converted back into a UTF-8 string using `TextDecoder`.
    const decryptedPrivateKey = new TextDecoder().decode(decryptedArrayBuffer);

    // Step 6: Parse the JSON string back into a JsonWebKey object
    // The decrypted message is a JSON string that represents the original private key.
    // `JSON.parse` converts it back into the original JsonWebKey object.
    return JSON.parse(decryptedPrivateKey);
  } catch (error) {
    // Handle any decryption errors (e.g., incorrect password, tampered data)
    console.error("Decryption failed:", error);
    return null; // Return null to indicate failure
  }
};

// Utility function to convert a JsonWebKey (JWK) into a CryptoKey object.
// This function enables the use of cryptographic keys (in JWK format) with the Web Crypto API.
// Parameters:
// - jwk: The JsonWebKey object to be converted.
// - isPrivate: A boolean indicating whether the key is private (used for key derivation) or not.
// Returns: A promise that resolves to a CryptoKey object.
const convertJwkToCryptoKey = async ({
  KeyInJwkFormat,
  isPrivateKey,
}: {
  KeyInJwkFormat: JsonWebKey;
  isPrivateKey: boolean;
}): Promise<CryptoKey | undefined> => {
  if (typeof window === "undefined") return;
  const crypto = window.crypto.subtle;

  try {
    let key; // Placeholder to store the resulting CryptoKey.

    // Step 1: Check the type of key (kty field in JWK) to determine the algorithm.
    if (KeyInJwkFormat.kty === "EC") {
      // If the key type is "EC" (Elliptic Curve), import it for use with the ECDH (Elliptic Curve Diffie-Hellman) algorithm.
      // This is typically used for key agreement or key exchange.
      key = await crypto.importKey(
        "jwk", // Input format: The key is in JWK format.
        KeyInJwkFormat, // The actual JWK object to import.
        {
          name: "ECDH", // The algorithm name: Elliptic Curve Diffie-Hellman.
          namedCurve: "P-384", // The curve to use: P-384 is a standard elliptic curve.
        },
        true, // Extractable: Indicates whether the key can be exported (true) or not (false).
        isPrivateKey ? ["deriveKey"] : []
        // Key usages: If it's a private key, it will be used for key derivation. Public keys will have an empty usage.
      );
    } else if (KeyInJwkFormat.kty === "oct") {
      // If the key type is "oct" (Octet sequence), assume it's a symmetric key for AES-GCM encryption.
      key = await crypto.importKey(
        "jwk", // Input format: The key is in JWK format.
        KeyInJwkFormat, // The actual JWK object to import.
        {
          name: "AES-GCM", // The algorithm name: AES-GCM (Authenticated Encryption with Galois/Counter Mode).
        },
        true, // Extractable: Indicates whether the key can be exported.
        ["encrypt", "decrypt"]
        // Key usages: The symmetric key will be used for encryption and decryption.
      );
    } else {
      // If the key type is neither "EC" nor "oct", throw an error as the key type is unsupported.
      throw new Error("Unsupported key type");
    }

    // Step 2: Return the resulting CryptoKey object.
    return key;
  } catch (error) {
    // Step 3: Handle errors that might occur during the key import process.
    // Rethrow the error to ensure that the calling context is aware of what went wrong.
    throw error;
  }
};

// Utility function to convert a CryptoKey object into a JsonWebKey (JWK) format.
// This is the reverse operation of importing a JWK into a CryptoKey, allowing
// for easier storage or transfer of the key in a standard, portable format.
//
// Parameters:
// - cryptoKey: The CryptoKey object to be converted into JWK format.
//
// Returns:
// - A promise that resolves to a JsonWebKey (JWK) object.
const convertCryptoKeyToJwk = async ({
  cryptoKey,
}: {
  cryptoKey: CryptoKey;
}): Promise<JsonWebKey | undefined> => {
  if (typeof window === "undefined") return;
  const crypto = window.crypto.subtle;

  // Step 1: Use the Web Crypto API's exportKey method to export the CryptoKey.
  // - The first parameter specifies the desired format ("jwk").
  // - The second parameter is the CryptoKey to export.
  const jwk = await crypto.exportKey("jwk", cryptoKey);

  // Step 2: Return the resulting JWK object.
  // - This is a plain JavaScript object that conforms to the JWK standard,
  //   containing properties such as "kty" (key type), "alg" (algorithm),
  //   and other relevant attributes depending on the key type.
  return jwk;
};

export {
  convertCryptoKeyToJwk,
  convertJwkToCryptoKey,
  decryptMessage,
  decryptPrivateKey,
  deriveSharedSecretKey,
  encryptMessage,
  encryptPrivateKey,
  generateKeyPair,
  encryptAudioBlob,
  decryptAudioBlob
};
