
enum OBJECT_STORE {
  privateKeys = "privateKeys",
  sharedKeys = "sharedKeys",
}


// Define constants for IndexedDB configuration
const DB_NAME = "Authentication"; // Name of the database
const VERSION = 1; // Database version

// Function to initialize IndexedDB
const initializeIndexDb = () => {
  if(typeof window === 'undefined') return;
  // Check if the IndexedDB API is supported by the browser
  const indexDb = window.indexedDB;
  if (!indexDb) {
    console.log("IndexedDB could not be found in this browser.");
    return; // Exit the function if IndexedDB is not supported
  }

  // Open (or create) the database with the specified name and version
  const request = indexDb.open(DB_NAME, VERSION);

  // Event triggered if the database needs an upgrade (e.g., new version or first-time creation)
  request.onupgradeneeded = function () {
    const db = request.result; // Get a reference to the database

    // Check if the 'privateKeys' object store already exists; create it if not
    if (!db.objectStoreNames.contains(OBJECT_STORE.privateKeys)) {
      db.createObjectStore(OBJECT_STORE.privateKeys, { keyPath: "userId" }); // Specify "userId" as the primary key
    }

    // Check if the 'sharedKeys' object store already exists; create it if not
    if (!db.objectStoreNames.contains(OBJECT_STORE.sharedKeys)) {
      db.createObjectStore(OBJECT_STORE.sharedKeys, { keyPath: "_id" }); // Specify "_id" as the primary key
    }
  };

  // Event triggered when the database connection is successfully established
  request.onsuccess = function () {
    // Currently no operation is performed here
    console.log("IndexedDB initialized successfully.");
  };

  // Event triggered if there is an error opening or interacting with the database
  request.onerror = function (event) {
    console.error("An error occurred with IndexedDB"); // Log a general error message
    console.error(event); // Log the specific error event for debugging
  };
};

// Function to store a user's private key in IndexedDB
const storeUserPrivateKeyInIndexedDB = async ({userId,privateKey}:{userId: string, privateKey: JsonWebKey}) => {
  if(typeof window === 'undefined') return;

  // Open (or create) the IndexedDB database
  const request = indexedDB.open(DB_NAME, VERSION);

  // Success callback for when the database is successfully opened
  request.onsuccess = function () {
    const db = request.result; // Get the reference to the opened database

    // Start a transaction on the 'privateKeys' object store with 'readwrite' access
    const transaction = db.transaction(OBJECT_STORE.privateKeys, "readwrite");

    // Get the object store (table) for private keys within the transaction
    const store = transaction.objectStore(OBJECT_STORE.privateKeys);

    // Prepare the data to be inserted: an object with 'userId' and 'privateKey'
    const putRequest = store.put({ userId, privateKey });

    // Success callback when the data is successfully inserted (or updated) in the store
    putRequest.onsuccess = function () {
      console.log("Private key stored successfully");
    };

    // Error callback if there is an issue inserting the data
    putRequest.onerror = function () {
      console.error("Error adding private key");
    };

    // This callback runs when the transaction has been completed (either successfully or not)
    transaction.oncomplete = function () {
      db.close(); // Close the database connection when the transaction is done
    };
  };
};

// Function to retrieve a user's private key from IndexedDB by userId
const getUserPrivateKeyFromIndexedDB = async ({userId}:{userId: string}): Promise<JsonWebKey | null> => {
  if(typeof window === 'undefined') return null;

  // Return a Promise to handle asynchronous behavior
  return new Promise((resolve, reject) => {
    // Open the IndexedDB database
    const request = indexedDB.open(DB_NAME, VERSION);

    // Success callback when the database is opened successfully
    request.onsuccess = function () {
      const db = request.result; // Get the reference to the opened database

      // Start a transaction on the 'privateKeys' object store with 'readonly' access
      const transaction = db.transaction(OBJECT_STORE.privateKeys, "readonly");

      // Get the object store (table) for private keys within the transaction
      const store = transaction.objectStore(OBJECT_STORE.privateKeys);

      // Create a request to retrieve the private key using the userId as the key
      const getRequest = store.get(userId);

      // Success callback when the private key is successfully retrieved
      getRequest.onsuccess = function () {
        const privatekey = getRequest.result?.privateKey; // Extract the privateKey from the result
        if (privatekey) {
          resolve(privatekey); // Resolve the Promise with the private key if found
        } else {
          resolve(null); // If no private key is found, resolve with null
        }
      };

      // Error callback if there is an error while retrieving the private key
      getRequest.onerror = function () {
        console.error("Error retrieving private key");
        reject(null); // Reject the Promise with null if an error occurs
      };

      // This callback runs when the transaction has been completed
      transaction.oncomplete = function () {
        db.close(); // Close the database connection when the transaction is done
      };
    };

    // Error callback if there is an issue opening the database
    request.onerror = function (event) {
      console.error("Error opening database:", event);
      reject(null); // Reject the Promise with null if the database cannot be opened
    };
  });
};

// Function to store a shared cryptographic key in IndexedDB
const storeSharedKeyInIndexedDB = async ({userId1,userId2,sharedKeyJwk}:{userId1: string, userId2: string, sharedKeyJwk: JsonWebKey}) => {
  if(typeof window === 'undefined') return;

  // Open the IndexedDB database (DB_NAME) and specify the version (VERSION)
  const request = indexedDB.open(DB_NAME, VERSION);

  // Success callback when the database is opened successfully
  request.onsuccess = function () {
    const db = request.result; // Get a reference to the opened database

    // Start a transaction on the 'sharedKeys' object store with 'readwrite' access (for both reading and writing data)
    const transaction = db.transaction(OBJECT_STORE.sharedKeys, "readwrite");

    // Get the object store (table) for shared keys within the transaction
    const store = transaction.objectStore(OBJECT_STORE.sharedKeys);

    // Create a request to store the shared key in the object store
    // The _id is generated by combining userId1 and userId2, which serves as the key for this entry
    const putRequest = store.put({
      _id: `${userId1}${userId2}`, // Composite key (userId1 + userId2) ensures a unique entry for each pair of users
      sharedKey: sharedKeyJwk, // Store the converted JWK shared key
    });

    // Success callback when the shared key is successfully stored
    putRequest.onsuccess = function () {
      console.log('shared key stored successfully'); // Log success message when the shared key is stored successfully
    };

    // Error callback if there is an error while storing the shared key
    putRequest.onerror = function () {
      console.error("Error adding shared key"); // Log error message if the shared key cannot be added
    };

    // This callback runs when the transaction has been completed, whether successfully or not
    transaction.oncomplete = function () {
      db.close(); // Close the database connection when the transaction is done
    };
  };

  // Error callback if there is an issue opening the database
  request.onerror = (event) => {
    console.error("Database error:", event); // Log error message if the database cannot be opened
  };
};

// Function to retrieve a stored shared cryptographic key between two users from IndexedDB
const getStoredSharedKeyFromIndexedDB = async ({userId1,userId2}:{userId1:string,userId2:string}):Promise<JsonWebKey | null> => {

  if(typeof window === 'undefined') return null;
  // Return a promise that will resolve with the stored shared key or null if not found
  return new Promise((resolve, reject) => {

    // Open the IndexedDB database (DB_NAME) and specify the version (VERSION)
    const request = indexedDB.open(DB_NAME, VERSION);

    // Success callback when the database is opened successfully
    request.onsuccess = () => {
      const db = request.result; // Get a reference to the opened database

      // Start a transaction on the 'sharedKeys' object store with 'readonly' access (for reading only)
      const transaction = db.transaction(OBJECT_STORE.sharedKeys, "readonly");

      // Get the object store (table) for shared keys within the transaction
      const store = transaction.objectStore(OBJECT_STORE.sharedKeys);

      // Create a request to retrieve the shared key using a composite key (userId1 + userId2)
      const getRequest = store.get(`${userId1}${userId2}`);

      // Success callback when the shared key is retrieved successfully
      getRequest.onsuccess = function () {
        if (getRequest.result) {
          // If a shared key is found, resolve the promise with the shared key (converted to JsonWebKey)
          const storedSharedKey = getRequest.result?.sharedKey as JsonWebKey;
          resolve(storedSharedKey);
        } else {
          // If no shared key is found, resolve the promise with null
          resolve(null);
        }
      };

      // Error callback if there is an error during the get operation
      getRequest.onerror = function (event) {
        console.error("Error retrieving shared key:", event); // Log the error details to the console
        resolve(null); // Resolve with null if there's an error retrieving the shared key
      };
    };

    // Error callback if there is an issue opening the database
    request.onerror = function (event) {
      console.error("Database error:", event); // Log the error details to the console
      reject(event); // Reject the promise with the error event if the database cannot be opened
    };
  });
};


export {
  getStoredSharedKeyFromIndexedDB, getUserPrivateKeyFromIndexedDB, initializeIndexDb, storeSharedKeyInIndexedDB, storeUserPrivateKeyInIndexedDB
};
