// src/__test-helpers__/secrets-test-setup.ts — Vitest setup file.
//
// Production installs the secret codec at startup (src/secrets/startup.ts), and every
// secret read or write without one is refused. Tests that exercise those paths get a
// fresh, random, in-memory keyring per test file here. Tests of the refusal itself
// call installSecretCodec(null) and restore the codec afterwards.

import { createSecretCodec, installSecretCodec } from "../secrets/secret-store.js";
import { generateKeyring } from "../secrets/keyring.js";

// The keyring is reachable as secretCodec().keyring.
installSecretCodec(createSecretCodec(generateKeyring()));
