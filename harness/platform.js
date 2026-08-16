/**
 * Platform adapter for running the shipping Reel Life modules in a browser.
 *
 * This is NOT a mock of any application logic. It supplies the two host
 * facilities Lens Studio provides and a browser does not, and nothing else:
 *
 *   print()                        -> console
 *   global.persistentStorageSystem -> localStorage
 *
 * `ReelStore`, `ReelDocument` and every Logic module under test are the real
 * shipping files, unmodified. localStorage is a genuinely persisted store: it
 * survives reload and browser restart, which is exactly the property the Lens
 * relies on persistentStorageSystem for.
 */

const STORAGE_PREFIX = "reellife:";

/** Implements Lens Studio's GeneralDataStore against localStorage. */
class LocalStorageDataStore {
  putString(key, value) {
    window.localStorage.setItem(STORAGE_PREFIX + key, value);
  }

  getString(key) {
    const value = window.localStorage.getItem(STORAGE_PREFIX + key);
    // GeneralDataStore returns an empty string for a missing key, not null.
    return value === null ? "" : value;
  }

  has(key) {
    return window.localStorage.getItem(STORAGE_PREFIX + key) !== null;
  }

  remove(key) {
    window.localStorage.removeItem(STORAGE_PREFIX + key);
  }

  clear() {
    const doomed = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.indexOf(STORAGE_PREFIX) === 0) {
        doomed.push(key);
      }
    }
    for (const key of doomed) {
      window.localStorage.removeItem(key);
    }
  }
}

const store = new LocalStorageDataStore();

globalThis.print = (message) => {
  // Routed to console.log, never console.error: the Lens logger emits its own
  // severity prefix, and promoting those to console errors would make the
  // harness look like it is failing when it is only logging.
  console.log(String(message));
};

globalThis.global = {
  persistentStorageSystem: { store },
};

export { store, STORAGE_PREFIX };
