"use strict";
// Versioned, in-place migrations for the validator's existing SQLite file.
// We never fork a second database — phase-1 tables (roots, personas,
// rep_events, blocks) stay exactly as they are and new state is added
// alongside them. Each migration runs once, tracked in schema_version.

// ZK PASS 2 Gate 2 — migration 006 drops persona → root from the validator.
// The ONLY migration with a down(): it needs a device-side roster
// ({ personaId: rootId } — the pre-006 export from validator/export-roster.js
// or the app's rosterExport) to restore the column, because after 006 the
// validator has no table that can answer it. down() is refused without
// one — a rollback that silently guesses is worse than none.
// PERSONA LAUNCH P5 (W2-MIGRATION-NONATOMIC) — ALTER TABLE … ADD COLUMN is the one DDL step SQLite cannot make
// idempotent ("IF NOT EXISTS" does not exist for columns). The runner is transactional now, so a failed up() leaves no
// column behind; this guard is for a database that crashed mid-migration under the OLD runner (columns added, no
// schema_version row), which must still boot. Table and column names are this file's constants, never input.
function addColumnIfMissing(db, table, column, decl) {
  if (!/^[a-z_][a-z0-9_]*$/.test(table) || !/^[a-z_][a-z0-9_]*$/.test(column)) throw new Error("addColumnIfMissing: bad identifier");
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl};`);
}

const MIGRATIONS = [
  {
    version: 1,
    name: "baseline",
    // Phase-1 tables are created by openDb()'s CREATE TABLE IF NOT EXISTS
    // block. This entry just records that an existing DB is at v1.
    up: () => {},
  },
  {
    version: 2,
    name: "adapter_state",
    // Durable storage for adapter state that has no real backend yet
    // (modes, rules, disclosure grants, schedules, saturation, channels,
    // graph claims, market state...). Namespaced key/value documents: the
    // adapter owns the shape, the validator owns durability. When the real
    // track implements an adapter for real, it gets purpose-built tables
    // and drops its namespace here.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS adapter_state (
          namespace TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (namespace, key)
        );
        CREATE INDEX IF NOT EXISTS adapter_state_ns ON adapter_state(namespace);
      `);
    },
  },
  {
    version: 3,
    name: "device_auth",
    // Crypto pass: device delegation verification. The validator stores
    // ONLY public material here — one device-auth anchor pubkey
    // (first-write-wins; single-root demo topology), registered device
    // delegations, and per-device-per-namespace envelope counters that
    // give "ordering" a checkable meaning. Never a private key of any
    // kind.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS device_auth (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          pubkey TEXT NOT NULL,
          registered_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS devices (
          device_id TEXT PRIMARY KEY,
          pubkey TEXT NOT NULL,
          delegation TEXT NOT NULL,
          registered_at INTEGER NOT NULL,
          revoked_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS envelope_counters (
          device_id TEXT NOT NULL,
          namespace TEXT NOT NULL,
          counter INTEGER NOT NULL,
          PRIMARY KEY (device_id, namespace)
        );
      `);
    },
  },
  {
    version: 4,
    name: "zk_layer",
    // ZK PASS 1: the validator's PUBLIC zk surface. Everything here is
    // public by construction — commitments (opaque Poseidon hashes),
    // tree roots, signed placements, the signed root history, nullifiers,
    // eligibility marks — plus ONE validator signing key that attests the
    // validator's OWN statements (which set it served; the split-view
    // defense). That key protects clients from a man-in-the-middle between
    // validator and client; it is not a secret that protects any user, and
    // it never touches user material. `mode` rides every row: fixture and
    // live are separate universes.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS zk_validator_key (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          pkcs8_hex TEXT NOT NULL,
          pub_hex TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS zk_epoch_offset (
          mode TEXT PRIMARY KEY,
          offset_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS zk_registrations (
          mode TEXT NOT NULL,
          commitment TEXT NOT NULL,
          root_id TEXT NOT NULL,
          registered_at INTEGER NOT NULL,
          epoch_registered INTEGER NOT NULL,
          active_from_epoch INTEGER NOT NULL,
          revoked_at INTEGER,
          revoked_from_epoch INTEGER,
          PRIMARY KEY (mode, commitment)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS zk_registrations_one_per_root ON zk_registrations(mode, root_id);
        CREATE TABLE IF NOT EXISTS zk_root_history (
          mode TEXT NOT NULL,
          tree TEXT NOT NULL,
          epoch INTEGER NOT NULL,
          root TEXT NOT NULL,
          prev_hash TEXT NOT NULL,
          hash TEXT NOT NULL,
          sig TEXT NOT NULL,
          issued_at INTEGER NOT NULL,
          PRIMARY KEY (mode, tree, epoch)
        );
        CREATE TABLE IF NOT EXISTS zk_placements (
          mode TEXT NOT NULL,
          tree TEXT NOT NULL,
          epoch INTEGER NOT NULL,
          commitment TEXT NOT NULL,
          leaf_index INTEGER NOT NULL,
          root TEXT NOT NULL,
          sig TEXT NOT NULL,
          PRIMARY KEY (mode, tree, epoch, commitment)
        );
        CREATE TABLE IF NOT EXISTS zk_nullifiers (
          mode TEXT NOT NULL,
          nullifier TEXT NOT NULL,
          claim_kind TEXT NOT NULL,
          tree TEXT NOT NULL,
          epoch INTEGER NOT NULL,
          PRIMARY KEY (mode, nullifier)
        );
        CREATE TABLE IF NOT EXISTS zk_eligibility (
          mode TEXT NOT NULL,
          persona_id TEXT NOT NULL,
          gate_id TEXT NOT NULL,
          tier INTEGER NOT NULL,
          epoch INTEGER NOT NULL,
          nullifier TEXT NOT NULL,
          PRIMARY KEY (mode, persona_id, gate_id, epoch)
        );
      `);
    },
  },
  {
    version: 5,
    name: "zk_anon_channel",
    // ZK PASS 1 Gate 1: the OHTTP gateway key (one X25519 keypair; the
    // validator is the gateway, a third party runs the relay), and the
    // tables the ANONYMOUS endpoint writes are rebuilt WITHOUT ROWID —
    // SQLite's implicit rowid is an arrival-order log, and the channel's
    // discipline is no request ordering at rest. Keyed on the nullifier,
    // the on-disk order is the order of a random-looking field element.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS zk_ohttp_key (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          key_id INTEGER NOT NULL,
          priv_hex TEXT NOT NULL,
          pub_hex TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE zk_nullifiers_v2 (
          mode TEXT NOT NULL,
          nullifier TEXT NOT NULL,
          claim_kind TEXT NOT NULL,
          tree TEXT NOT NULL,
          epoch INTEGER NOT NULL,
          PRIMARY KEY (mode, nullifier)
        ) WITHOUT ROWID;
        INSERT INTO zk_nullifiers_v2 SELECT mode, nullifier, claim_kind, tree, epoch FROM zk_nullifiers;
        DROP TABLE zk_nullifiers;
        ALTER TABLE zk_nullifiers_v2 RENAME TO zk_nullifiers;
        CREATE TABLE zk_eligibility_v2 (
          mode TEXT NOT NULL,
          persona_id TEXT NOT NULL,
          gate_id TEXT NOT NULL,
          tier INTEGER NOT NULL,
          epoch INTEGER NOT NULL,
          nullifier TEXT NOT NULL,
          PRIMARY KEY (mode, persona_id, gate_id, epoch)
        ) WITHOUT ROWID;
        INSERT INTO zk_eligibility_v2 SELECT mode, persona_id, gate_id, tier, epoch, nullifier FROM zk_eligibility;
        DROP TABLE zk_eligibility;
        ALTER TABLE zk_eligibility_v2 RENAME TO zk_eligibility;
      `);
    },
  },
  {
    version: 6,
    name: "personas_without_root",
    // ZK PASS 2 Gate 2: THE VALIDATOR STOPS KNOWING persona → root.
    //   personas.root_id  → dropped (rebuilt table: SQLite DROP COLUMN cannot
    //                       remove a REFERENCES column, so the table is rebuilt)
    //   blocks            → blocks_v2(blocker_persona, blocked_persona):
    //                       persona-level, no root join; root-level fan-out
    //                       is gone BY DESIGN (SECURITY-POSTURE "What zk cost
    //                       us"). Existing root-level rows cannot be
    //                       translated without the column, so they are kept
    //                       in blocks_legacy_export — read by NOTHING but the
    //                       down-migration (the rollback material for blocks;
    //                       rule 4: no deletion without a rollback).
    // Transactional: a crash mid-way leaves the pre-006 schema intact. PERSONA LAUNCH P5 (W2-MIGRATION-NONATOMIC): the
    // transaction is now the RUNNER's (migrate() wraps every up() and its schema_version row in one BEGIN … COMMIT), so
    // this up() opens none of its own — SQLite has no nested BEGIN, and a second one here would refuse to boot.
    up: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS personas_v2;
        CREATE TABLE personas_v2 (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          handle TEXT UNIQUE NOT NULL,
          avatar_url TEXT,
          bio TEXT,
          created_at INTEGER NOT NULL
        );
        INSERT INTO personas_v2 (id, name, handle, avatar_url, bio, created_at)
          SELECT id, name, handle, avatar_url, bio, created_at FROM personas;
        DROP TABLE personas;
        ALTER TABLE personas_v2 RENAME TO personas;
        CREATE TABLE IF NOT EXISTS blocks_v2 (
          blocker_persona TEXT NOT NULL,
          blocked_persona TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (blocker_persona, blocked_persona)
        );
        CREATE TABLE IF NOT EXISTS blocks (
          blocker_root TEXT NOT NULL,
          blocked_root TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (blocker_root, blocked_root)
        );
        DROP TABLE IF EXISTS blocks_legacy_export;
        CREATE TABLE blocks_legacy_export AS SELECT * FROM blocks;
        DROP TABLE blocks;
      `);
    },
    // down(db, roster, opts): roster = { personaId: rootId } exported by the
    // device. opts.orphans: "refuse" (default) | "quarantine" — personas the
    // roster cannot attribute are moved (never deleted) to
    // personas_orphaned_on_rollback when quarantining.
    down: (db, roster, opts = {}) => {
      if (!roster || typeof roster !== "object") {
        throw new Error("migration 006 down: a device-side roster export ({ personaId: rootId }) is required — refusing to guess persona → root");
      }
      const rows = db.prepare("SELECT id, name, handle, avatar_url, bio, created_at FROM personas ORDER BY created_at, id").all();
      const missing = rows.filter((p) => !roster[p.id]).map((p) => p.id);
      const policy = opts.orphans || "refuse";
      if (missing.length && policy !== "quarantine") {
        throw new Error("migration 006 down: the roster export lacks " + missing.length + " persona(s): " + missing.slice(0, 5).join(",") + " — refusing to guess persona → root (pass orphans=quarantine to move them to personas_orphaned_on_rollback instead)");
      }
      const rootExists = db.prepare("SELECT 1 FROM roots WHERE id = ?");
      for (const p of rows) {
        if (roster[p.id] && !rootExists.get(roster[p.id])) throw new Error("migration 006 down: the roster names an unknown root " + roster[p.id] + " for persona " + p.id);
      }
      db.exec(`
        DROP TABLE IF EXISTS personas_v1;
        CREATE TABLE personas_v1 (
          id TEXT PRIMARY KEY,
          root_id TEXT NOT NULL REFERENCES roots(id),
          name TEXT NOT NULL,
          handle TEXT UNIQUE NOT NULL,
          avatar_url TEXT,
          bio TEXT,
          created_at INTEGER NOT NULL
        );
      `);
      if (missing.length) {
        db.exec(`CREATE TABLE IF NOT EXISTS personas_orphaned_on_rollback (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, handle TEXT NOT NULL, avatar_url TEXT, bio TEXT, created_at INTEGER NOT NULL, quarantined_at INTEGER NOT NULL
        )`);
      }
      const ins = db.prepare("INSERT INTO personas_v1 (id, root_id, name, handle, avatar_url, bio, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
      const quarantine = missing.length ? db.prepare("INSERT OR REPLACE INTO personas_orphaned_on_rollback (id, name, handle, avatar_url, bio, created_at, quarantined_at) VALUES (?, ?, ?, ?, ?, ?, ?)") : null;
      let restored = 0;
      for (const p of rows) {
        if (roster[p.id]) { ins.run(p.id, roster[p.id], p.name, p.handle, p.avatar_url, p.bio, p.created_at); restored++; }
        else quarantine.run(p.id, p.name, p.handle, p.avatar_url, p.bio, p.created_at, Date.now());
      }
      db.exec(`
        DROP TABLE personas;
        ALTER TABLE personas_v1 RENAME TO personas;
        CREATE TABLE IF NOT EXISTS blocks (
          blocker_root TEXT NOT NULL,
          blocked_root TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (blocker_root, blocked_root)
        );
        INSERT OR IGNORE INTO blocks SELECT blocker_root, blocked_root, created_at FROM blocks_legacy_export;
        DROP TABLE IF EXISTS blocks_legacy_export;
        DROP TABLE IF EXISTS blocks_v2;
        DELETE FROM schema_version WHERE version = 6;
      `);
      return { restored, quarantined: missing.length };
    },
  },
  {
    version: 7,
    name: "zk_fork_revocation_attestation",
    // ZK PASS 2 Gate 3. All public material, like migration 004:
    //   zk_fork_claims        — a verified "fork-continuity" proof: the NEW
    //                           persona, the fork COMMITMENT (a hash the old
    //                           persona is hidden behind; the nonce lives
    //                           only in the device's forward pointer), tier,
    //                           epoch, nullifier. The validator never learns
    //                           old → new.
    //   zk_attestations       — issuer attestations on a COMMITMENT with an
    //                           expiry epoch (scaffolding; the mock issuer is
    //                           a dev hook; the real issuer is a decision).
    //   zk_attestation_claims — a verified "attestation" proof per persona,
    //                           issuer and epoch (a presence log pruned like
    //                           zk_eligibility).
    //   zk_registrations      — one ACTIVE commitment per root (revocation
    //                           via epoch re-issuance): the hard unique index
    //                           becomes a partial one over unrevoked rows, so
    //                           a revoked root can register a NEW commitment.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS zk_fork_claims (
          mode TEXT NOT NULL,
          persona_id TEXT NOT NULL,
          fork_commit TEXT NOT NULL,
          tree TEXT NOT NULL,
          tier INTEGER NOT NULL,
          epoch INTEGER NOT NULL,
          nullifier TEXT NOT NULL,
          PRIMARY KEY (mode, persona_id, fork_commit)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS zk_attestations (
          mode TEXT NOT NULL,
          issuer TEXT NOT NULL,
          commitment TEXT NOT NULL,
          issued_epoch INTEGER NOT NULL,
          expires_epoch INTEGER NOT NULL,
          sig TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (mode, issuer, commitment)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS zk_attestation_claims (
          mode TEXT NOT NULL,
          persona_id TEXT NOT NULL,
          issuer TEXT NOT NULL,
          epoch INTEGER NOT NULL,
          nullifier TEXT NOT NULL,
          PRIMARY KEY (mode, persona_id, issuer, epoch)
        ) WITHOUT ROWID;
        DROP INDEX IF EXISTS zk_registrations_one_per_root;
        CREATE UNIQUE INDEX IF NOT EXISTS zk_registrations_one_active_per_root
          ON zk_registrations(mode, root_id) WHERE revoked_from_epoch IS NULL;
      `);
    },
  },
  {
    version: 8,
    name: "hour_grain_timestamps",
    // ZK PASS 2 Gate 4 (attack-z2-1 #2, attack-z2-2 #4): nothing persona- or
    // root-addressed on this validator carries a timestamp finer than the
    // hour. New rows are written that way (server.js hourGrain, zk.js
    // hourGrainMs); this coarsens what was already on disk — persona
    // creation, block rows, state flushes, registration/revocation clocks.
    // No rollback: the millisecond was the leak; nothing legitimate reads it.
    up: (db) => {
      db.exec(`
        UPDATE personas SET created_at = created_at - (created_at % 3600000);
        UPDATE blocks_v2 SET created_at = created_at - (created_at % 3600000);
        UPDATE adapter_state SET updated_at = updated_at - (updated_at % 3600000);
        UPDATE zk_registrations SET registered_at = registered_at - (registered_at % 3600000);
        UPDATE zk_registrations SET revoked_at = revoked_at - (revoked_at % 3600000) WHERE revoked_at IS NOT NULL;
      `);
    },
  },
  {
    version: 9,
    name: "attestation_issuers_and_buckets",
    // ATTESTATION PASS Gate 1 — THE OPEN ISSUER INTERFACE.
    //   zk_issuers            — anyone can register an issuer: a namespaced
    //                           id ("onchain.wallet-age"), an Ed25519 key,
    //                           a claim schema, the BUCKETS it emits and a
    //                           validity in epochs. Registration is open and
    //                           self-signed; the key IS the identity (a
    //                           rotation is a new id). Trust is the
    //                           SUBSCRIBER's choice, never the validator's.
    //   zk_attestations       — now keyed by (issuer, BUCKET, commitment) and
    //                           carrying the ISSUER's signature, a claim hash
    //                           (over a nonce-salted claim that lives in the
    //                           subject's vault — the validator never holds a
    //                           value), an activation epoch (batched: the next
    //                           epoch after submission), an expiry and an
    //                           issuer revocation epoch. The mock scaffolding
    //                           rows migrate into bucket "any".
    //   zk_attestation_claims — a proof is per (persona, issuer, bucket,
    //                           epoch): the bucket is the coarse public
    //                           attribute a gated surface predicates on.
    // The validator learns: issuer I vouched for commitment C under bucket
    // B, from epoch E until epoch X. Never the value, never a wallet.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS zk_issuers (
          mode TEXT NOT NULL,
          id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          schema_json TEXT NOT NULL,
          buckets_json TEXT NOT NULL,
          validity_epochs INTEGER NOT NULL,
          pubkey TEXT NOT NULL,
          sig TEXT NOT NULL,
          registered_at INTEGER NOT NULL,
          PRIMARY KEY (mode, id)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS zk_attestations_v2 (
          mode TEXT NOT NULL,
          issuer TEXT NOT NULL,
          bucket TEXT NOT NULL,
          commitment TEXT NOT NULL,
          claim_hash TEXT NOT NULL,
          issued_epoch INTEGER NOT NULL,
          active_from_epoch INTEGER NOT NULL,
          expires_epoch INTEGER NOT NULL,
          revoked_from_epoch INTEGER,
          sig TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (mode, issuer, bucket, commitment)
        ) WITHOUT ROWID;
        INSERT OR IGNORE INTO zk_attestations_v2 (mode, issuer, bucket, commitment, claim_hash, issued_epoch, active_from_epoch, expires_epoch, revoked_from_epoch, sig, created_at)
          SELECT mode, issuer, 'any', commitment, '', issued_epoch, issued_epoch + 1, expires_epoch, NULL, sig, created_at - (created_at % 3600000) FROM zk_attestations;
        DROP TABLE zk_attestations;
        ALTER TABLE zk_attestations_v2 RENAME TO zk_attestations;
        CREATE TABLE IF NOT EXISTS zk_attestation_claims_v2 (
          mode TEXT NOT NULL,
          persona_id TEXT NOT NULL,
          issuer TEXT NOT NULL,
          bucket TEXT NOT NULL,
          epoch INTEGER NOT NULL,
          nullifier TEXT NOT NULL,
          PRIMARY KEY (mode, persona_id, issuer, bucket, epoch)
        ) WITHOUT ROWID;
        INSERT OR IGNORE INTO zk_attestation_claims_v2 (mode, persona_id, issuer, bucket, epoch, nullifier)
          SELECT mode, persona_id, issuer, 'any', epoch, nullifier FROM zk_attestation_claims;
        DROP TABLE zk_attestation_claims;
        ALTER TABLE zk_attestation_claims_v2 RENAME TO zk_attestation_claims;
      `);
    },
  },
  {
    version: 10,
    name: "anon_casts",
    // MULTI-FID PASS Gate 4 — anon-post mode (the anoncast pattern). The
    // validator relays a proof-authorised text through its shared anon account
    // and records ONLY what the network shows anyway: the text, its content
    // hash, the epoch, an hour-grained time, the network hash and the shared
    // fid. No persona, no root, no nullifier on this row: the nullifier lives
    // in zk_nullifiers with the claim kind, as for every claim, and joins to
    // nothing here.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS zk_anon_casts (
          mode TEXT NOT NULL,
          cast_hash TEXT NOT NULL,
          text TEXT NOT NULL,
          epoch INTEGER NOT NULL,
          relayed_at INTEGER NOT NULL,
          network_hash TEXT NOT NULL,
          fid INTEGER NOT NULL,
          PRIMARY KEY (mode, cast_hash)
        ) WITHOUT ROWID;
      `);
    },
    down: (db) => {
      db.exec("DROP TABLE IF EXISTS zk_anon_casts;");
    },
  },

  {
    version: 11,
    name: "anon_casts_status",
    // MULTI-FID PASS Gate 5 (D-FID-5-STORE-AND-FORWARD): a LIVE anon row is
    // PENDING until the validator's own relay slot posts it — the network
    // timestamp is the slot, never the submission time. Existing rows were
    // relayed on receipt.
    up: (db) => {
      db.exec("ALTER TABLE zk_anon_casts ADD COLUMN status TEXT NOT NULL DEFAULT 'relayed';");
    },
    down: (db) => {
      db.exec(`
        CREATE TABLE zk_anon_casts_v0 AS SELECT mode, cast_hash, text, epoch, relayed_at, network_hash, fid FROM zk_anon_casts;
        DROP TABLE zk_anon_casts;
        ALTER TABLE zk_anon_casts_v0 RENAME TO zk_anon_casts;
      `);
    },
  },

  {
    version: 12,
    name: "anon_casts_attribution",
    // MULTI-FID PASS — the anoncast reveal pattern: an anon post's message binds a COMMITMENT
    // (sha256 of a secret only the poster's device ever holds) at post time; later, at the poster's
    // own choice, revealing the secret attributes the row to a real fid — once, forever, never
    // automatic. attribution_commitment is set on every anon-post row from here on; the two
    // attributed_* columns stay NULL until (if ever) a reveal succeeds.
    up: (db) => {
      db.exec(`
        ALTER TABLE zk_anon_casts ADD COLUMN attribution_commitment TEXT;
        ALTER TABLE zk_anon_casts ADD COLUMN attributed_fid INTEGER;
        ALTER TABLE zk_anon_casts ADD COLUMN attributed_at INTEGER;
      `);
    },
    down: (db) => {
      db.exec(`
        CREATE TABLE zk_anon_casts_v1 AS SELECT mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status FROM zk_anon_casts;
        DROP TABLE zk_anon_casts;
        ALTER TABLE zk_anon_casts_v1 RENAME TO zk_anon_casts;
      `);
    },
  },

  {
    version: 13,
    name: "anon_casts_attribution_signer",
    // MULTI-FID PASS §14.2 — a reveal is a CLAIM, and a claim needs evidence. Migration 12 took the
    // fid on the caller's word, which is only a control if the caller is our app; this validator is a
    // shared service and an observer (§14 removed the persona->fid map from it for exactly that
    // reason), so a secret holder could have their post recorded against someone else's fid. From
    // here the reveal carries a signature by the attributing fid's OWN Farcaster signer key over
    // layers-anon-reveal/1|<mode>|<castHash>|<fid>|<signerPubKey>, and the key it verified under is
    // stored beside the fid. The validator cannot tell whose key that is — it holds no fid->key
    // binding and must not — so it VERIFIES and CARRIES; the reader ties the key to the fid against
    // the Farcaster key registry, and a reader who cannot must not render the attribution.
    up: (db) => {
      db.exec(`ALTER TABLE zk_anon_casts ADD COLUMN attributed_signer TEXT;`);
    },
    down: (db) => {
      db.exec(`
        CREATE TABLE zk_anon_casts_v12 AS SELECT mode, cast_hash, text, epoch, relayed_at, network_hash, fid, status, attribution_commitment, attributed_fid, attributed_at FROM zk_anon_casts;
        DROP TABLE zk_anon_casts;
        ALTER TABLE zk_anon_casts_v12 RENAME TO zk_anon_casts;
      `);
    },
  },


  {
    version: 14,
    name: "stakes",
    // MEGA PASS 2 Gate 1 — per-persona spend events of the reputation UBI: a signed, public stake on a cast.
    // No root, no balance, no tier, no device. WITHOUT ROWID keyed on the stake id so insertion order is not
    // kept; created_at is hour-grained. See validator/stakes.js.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS stakes (
          mode TEXT NOT NULL,
          id TEXT NOT NULL,
          persona_id TEXT NOT NULL,
          cast_hash TEXT NOT NULL,
          action TEXT NOT NULL,
          direction TEXT NOT NULL,
          amount INTEGER NOT NULL,
          epoch INTEGER NOT NULL,
          nonce TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          pubkey TEXT NOT NULL,
          signature TEXT NOT NULL,
          PRIMARY KEY (mode, id)
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS stakes_cast ON stakes(mode, cast_hash);
        CREATE INDEX IF NOT EXISTS stakes_persona ON stakes(mode, persona_id);
        CREATE INDEX IF NOT EXISTS stakes_epoch ON stakes(mode, epoch);
      `);
    },
    down: (db) => {
      db.exec(`DROP TABLE IF EXISTS stakes;`);
    },
  },
  {
    version: 15,
    name: "rep_events_hour_grain",
    // MEGA PASS 2 Gate 7 (attack-mega-1 F1): rep events were the one root-adjacent row still stamped with the
    // millisecond. New rows are written at the hour (server.js, seed.js, poller.js); this coarsens what was already
    // on disk. Insertion order (the AUTOINCREMENT rowid) is kept and named as A-MEGA2-REP-EVENTS-KEEP-ORDER.
    up: (db) => {
      db.exec(`UPDATE rep_events SET created_at = created_at - (created_at % 3600000);`);
    },
  },
  {
    version: 16,
    name: "multi_anchor",
    // BROWSER KEYSTORE PASS Gate 1 stage 2 (docs/custody-model.md D-CU-0-5): one device-auth anchor per root instead
    // of one per validator. Devices, roots and state rows carry the anchor they belong to; every existing row moves
    // under the anchor that was registered (the rig's), or "legacy" if none was.
    up: (db) => {
      const existing = db.prepare("SELECT pubkey FROM device_auth WHERE id = 1").get();
      const legacy = existing ? existing.pubkey : "legacy";
      db.exec(`
        CREATE TABLE device_auth_v2 (pubkey TEXT PRIMARY KEY, registered_at INTEGER NOT NULL);
        INSERT INTO device_auth_v2 (pubkey, registered_at) SELECT pubkey, registered_at FROM device_auth;
        DROP TABLE device_auth;
        ALTER TABLE device_auth_v2 RENAME TO device_auth;
        ALTER TABLE devices ADD COLUMN anchor TEXT;
        ALTER TABLE roots ADD COLUMN anchor TEXT;
        CREATE TABLE adapter_state_v2 (
          anchor TEXT NOT NULL,
          namespace TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (anchor, namespace, key)
        );
      `);
      db.prepare("INSERT INTO adapter_state_v2 (anchor, namespace, key, value, updated_at) SELECT ?, namespace, key, value, updated_at FROM adapter_state").run(legacy);
      db.exec(`
        DROP TABLE adapter_state;
        ALTER TABLE adapter_state_v2 RENAME TO adapter_state;
        CREATE INDEX IF NOT EXISTS adapter_state_ns ON adapter_state(anchor, namespace);
      `);
      db.prepare("UPDATE devices SET anchor = ? WHERE anchor IS NULL").run(legacy);
      db.prepare("UPDATE roots SET anchor = ? WHERE anchor IS NULL").run(legacy);
    },
  },
  {
    version: 17,
    name: "custody_methods_and_blobs",
    // BROWSER KEYSTORE PASS Gate 2 (docs/custody-model.md D-CU-0-7): a save method is a public identifier bound to a
    // root's anchor, and its wrapped-seed blob is ciphertext the validator cannot open. Both keyed by method id.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS custody_methods (
          method_id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          anchor TEXT NOT NULL,
          pubkey_spki TEXT,
          alg INTEGER,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS custody_methods_anchor ON custody_methods(anchor);
        CREATE TABLE IF NOT EXISTS custody_blobs (
          method_id TEXT PRIMARY KEY,
          anchor TEXT NOT NULL,
          blob TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 18,
    name: "link_offers",
    // BROWSER KEYSTORE PASS Gate 3 (D-CU-3-OFFERS-ARE-CREATE-ONCE-AND-SHORT-LIVED): the device-linking relay. A device
    // key, an HPKE public key, a code, and, once the old device answers, ciphertext and the anchor that sealed it.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS link_offers (
          code TEXT PRIMARY KEY,
          device_id TEXT NOT NULL,
          device_pubkey TEXT NOT NULL,
          hpke_pub TEXT NOT NULL,
          sealed TEXT,
          anchor TEXT,
          root_id TEXT,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 19,
    name: "root_link_relay",
    // BROWSER KEYSTORE PASS Gate 3 (D-CU-3-A-ROOT-LINK-IS-A-CO-SIGNED-GRANT): the proposal/answer/completion relay for
    // a pairwise grant between two roots, and the revocation list by grant id. Two public anchors; no grant body
    // outlives the exchange here — each root keeps the grant sealed in its own vault.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS root_link_offers (
          code TEXT PRIMARY KEY,
          anchor_a TEXT NOT NULL,
          proposal TEXT NOT NULL,
          anchor_b TEXT,
          answer TEXT,
          sig_a TEXT,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS root_link_revocations (
          grant_id TEXT PRIMARY KEY,
          anchor TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    version: 20,
    name: "custody_review_fixes",
    // BROWSER KEYSTORE PASS Gate 5 (research/attack-custody-1 #11, #12; attack-custody-3 #9): a grant's two parties
    // recorded at completion so revocation is party-scoped; offers counted per creating address; seeded roots
    // carry a sentinel anchor so a signed stranger cannot claim one by its known signer id.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS root_link_grants (
          grant_id TEXT PRIMARY KEY,
          anchor_a TEXT NOT NULL,
          anchor_b TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        ALTER TABLE link_offers ADD COLUMN created_by TEXT;
        UPDATE roots SET anchor = 'seed' WHERE anchor IS NULL;
      `);
    },
  },
  {
    version: 21,
    name: "zk_anon_casts_tree_note",
    // PERSONA LAUNCH P3 (the anon track; the number is fixed by the wave-1 ownership map: 21 anon, 22 byx). Two nullable
    // columns on the anon cast row, both PUBLIC by construction:
    //   tree — the tree the post proved membership in. Every post proves the configured anon tree today; P5 lets a post
    //          prove a reach tree ("an account with 10k+ followers") and the For You boost reads it from here. Rows from
    //          before this migration stay NULL (they all proved the one configured tree).
    //   note — RESERVED for P4: the fixed-size ring note (256 bytes, real or random, the same size with or without a
    //          ring). NULL on every row until P4 writes it, so no row's shape differs from another's.
    // Deliberately NOT a column: the slot index (it rides the wire and is never stored — A-ANON-SLOT-INDEX-VISIBLE), the
    // persona, the root, the nullifier.
    up: (db) => {
      db.exec(`
        ALTER TABLE zk_anon_casts ADD COLUMN tree TEXT;
        ALTER TABLE zk_anon_casts ADD COLUMN note TEXT;
      `);
    },
    down: (db) => {
      db.exec(`
        ALTER TABLE zk_anon_casts DROP COLUMN note;
        ALTER TABLE zk_anon_casts DROP COLUMN tree;
      `);
    },
  },
  {
    version: 22,
    name: "x_index",
    // PERSONA LAUNCH P2 (the byx track's block, appended here by the anon track, which owns this file this wave): the
    // keyless X-handle index — the current fname per fid and the indexer's cursor (validator/xindex.js).
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS x_fname_current (
          fid INTEGER PRIMARY KEY,
          username TEXT NOT NULL,
          transfer_id INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS x_index_cursor (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 23,
    name: "ring_drop",
    // PERSONA LAUNCH P4 (the rings track's block, appended by reach, which owns this file this wave; numbers fixed by the
    // wave-2 ownership map: 23 rings, 24 reach, 25 launch). The friend-whitelist DEAD DROP (validator/ringdrop.js): sealed,
    // fixed-size envelopes under an opaque id, an hour-grained expiry and the hash of a delete token — no sender, no
    // recipient, no ring, no persona.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ring_drop (
          id TEXT PRIMARY KEY,
          enc TEXT NOT NULL,
          ct TEXT NOT NULL,
          hint TEXT NOT NULL,
          expires_hour INTEGER NOT NULL,
          del_hash TEXT NOT NULL
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS ring_drop_exp ON ring_drop(expires_hour);
      `);
    },
    down: (db) => {
      db.exec(`DROP TABLE IF EXISTS ring_drop;`);
    },
  },
  {
    version: 24,
    name: "zk_anon_casts_tree_size",
    // PERSONA LAUNCH P5 (reach tiers). The SIZE of the frozen tree an anon post proved, at its epoch (the count of the
    // signed placements). PUBLIC by construction — anyone can count the leaves of a published tree — and recorded so the
    // For You label ("posted by an account with 10k+ followers") is judged from the crowd the post was actually made in,
    // not the crowd of whatever epoch a reader happens to read it in (lib/reach/boost.ts). NULL on rows from before.
    // Idempotent (W2-MIGRATION-NONATOMIC): a database that crashed mid-24 under the old non-transactional runner may
    // already hold the column with no schema_version row — re-running must finish, not refuse to boot.
    up: (db) => {
      addColumnIfMissing(db, "zk_anon_casts", "tree_size", "INTEGER");
    },
    down: (db) => {
      db.exec(`ALTER TABLE zk_anon_casts DROP COLUMN tree_size;`);
    },
  },
  {
    version: 25,
    name: "launch_registrar",
    // PERSONA LAUNCH P6 (the launch track's block, appended by reach). The SIMULATED registrar of this wave: the queue of
    // anonymous launch requests (no root, no persona — a custody address and a profile), a fixture chain (fids, keys,
    // fnames) standing in for Farcaster's Bundler and registries, a $0 spend ledger, the sim clock behind the 2–48 h
    // random batch, the launch's batch reveals, and the batch that attributed each anon post.
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS launch_queue (
          id TEXT PRIMARY KEY,
          mode TEXT NOT NULL,
          launch_commit TEXT NOT NULL UNIQUE,
          request TEXT NOT NULL,
          requested_hour INTEGER,
          due_at INTEGER,
          status TEXT,
          fid INTEGER,
          batch_id TEXT
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS sim_chain_fids (
          mode TEXT NOT NULL,
          fid INTEGER NOT NULL,
          custody TEXT NOT NULL,
          recovery TEXT,
          registered_at INTEGER,
          storage_units INTEGER,
          batch_id TEXT,
          PRIMARY KEY (mode, fid),
          UNIQUE (mode, custody)
        );
        CREATE TABLE IF NOT EXISTS sim_chain_keys (
          mode TEXT NOT NULL,
          fid INTEGER NOT NULL,
          key TEXT NOT NULL,
          key_type INTEGER,
          request_fid INTEGER,
          added_at INTEGER,
          removed_at INTEGER,
          PRIMARY KEY (mode, fid, key)
        );
        CREATE TABLE IF NOT EXISTS sim_chain_fnames (
          mode TEXT NOT NULL,
          fname TEXT NOT NULL,
          fid INTEGER NOT NULL,
          set_at INTEGER,
          PRIMARY KEY (mode, fname)
        );
        CREATE TABLE IF NOT EXISTS registrar_spend (
          id TEXT PRIMARY KEY,
          mode TEXT NOT NULL,
          batch_id TEXT,
          items INTEGER,
          usd_cents INTEGER,
          gas_wei TEXT,
          simulated INTEGER,
          created_hour INTEGER
        );
        CREATE TABLE IF NOT EXISTS registrar_clock (
          mode TEXT PRIMARY KEY,
          offset_ms INTEGER,
          next_batch_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS zk_reveal_batches (
          mode TEXT NOT NULL,
          batch_hash TEXT NOT NULL,
          fid INTEGER,
          signer TEXT,
          signature TEXT,
          cast_hashes TEXT,
          revealed_at INTEGER,
          PRIMARY KEY (mode, batch_hash)
        );
      `);
      // the one non-idempotent step, guarded (W2-MIGRATION-NONATOMIC: see addColumnIfMissing)
      addColumnIfMissing(db, "zk_anon_casts", "attributed_batch", "TEXT");
    },
    down: (db) => {
      db.exec(`
        ALTER TABLE zk_anon_casts DROP COLUMN attributed_batch;
        DROP TABLE IF EXISTS zk_reveal_batches;
        DROP TABLE IF EXISTS registrar_clock;
        DROP TABLE IF EXISTS registrar_spend;
        DROP TABLE IF EXISTS sim_chain_fnames;
        DROP TABLE IF EXISTS sim_chain_keys;
        DROP TABLE IF EXISTS sim_chain_fids;
        DROP TABLE IF EXISTS launch_queue;
      `);
    },
  },
  {
    version: 26,
    name: "x_anon_outbox",
    // PERSONA LAUNCH P8 (the xout track; wave 3's numbers were fixed: 26 xout. The "27 reserved for prover" note of wave 3
    // is void: the prover needed no table). PUBLIC GO-LIVE: 27 'launch_registrar_live' and 28 'x_live' are RESERVED by the
    // two PARKED owner-service tracks (the live registrar and live posting to X; their full diffs are saved outside the
    // tree as parked-registrar.patch and parked-xlive.patch) and are never reused; no deployed service ever applied them,
    // and the runner tolerates the gap. The next free number is the one after the last entry below. THE @totem X
    // OUTBOX, FIXTURE ONLY (validator/xoutbox.js). Why these four tables and nothing else: an anonymous X copy is a TEXT
    // the validator holds until a moderator decides (the owner rule: moderation BEFORE anything posts, because X suspends
    // a shared account that posts spam), so the row is the text, its public shape (kind, the one link) and its state; the
    // decisions are kept signed (who approved what, checkable later); dev moderators are the rig's own keys; the fixture
    // posts stand in for X itself. Deliberately NOT a column anywhere: a persona, a root, a nullifier, a slot, a device or
    // a cast hash — the row id is the xHash, a salted hash of the text only (domain "layers-x-anon/1"). EVERY TIME IS
    // HOUR-GRAINED (created/decided/due/posted/added hours, as ms at the top of an hour): a finer clock would pair a row
    // with the anonymous send that made it. Idempotent (IF NOT EXISTS) and reversible (down drops exactly these).
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS x_outbox (
          mode TEXT NOT NULL,
          id TEXT NOT NULL,
          text TEXT NOT NULL,
          kind TEXT NOT NULL,
          url TEXT,
          status TEXT NOT NULL,
          created_hour INTEGER NOT NULL,
          decided_hour INTEGER,
          due_at INTEGER,
          posted_id TEXT,
          posted_hour INTEGER,
          attempts INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (mode, id)
        ) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS x_outbox_by_status ON x_outbox(mode, status);
        CREATE TABLE IF NOT EXISTS x_outbox_decisions (
          mode TEXT NOT NULL,
          id TEXT NOT NULL,
          decision TEXT NOT NULL,
          moderator_pubkey TEXT NOT NULL,
          signature TEXT NOT NULL,
          decided_hour INTEGER NOT NULL,
          PRIMARY KEY (mode, signature)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS x_outbox_moderators (
          mode TEXT NOT NULL,
          pubkey TEXT NOT NULL,
          added_hour INTEGER NOT NULL,
          PRIMARY KEY (mode, pubkey)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS x_fixture_posts (
          mode TEXT NOT NULL,
          posted_id TEXT NOT NULL,
          text TEXT NOT NULL,
          posted_hour INTEGER NOT NULL,
          PRIMARY KEY (mode, posted_id)
        ) WITHOUT ROWID;
      `);
    },
    down: (db) => {
      db.exec(`
        DROP TABLE IF EXISTS x_fixture_posts;
        DROP TABLE IF EXISTS x_outbox_moderators;
        DROP TABLE IF EXISTS x_outbox_decisions;
        DROP INDEX IF EXISTS x_outbox_by_status;
        DROP TABLE IF EXISTS x_outbox;
      `);
    },
  },
  {
    version: 29,
    name: "anon_public_safety",
    // PUBLIC GO-LIVE (the relay track). NUMBERS: 27 'launch_registrar_live' and 28 'x_live' belong to the registrar and
    // xlive tracks (finished or parked) and are NEVER reused, whether or not their entries sit in this array; the runner
    // tolerates the gap. The next number after this one is 30 (anon_fid_leave, below); the next free one is 31.
    // WHAT THIS IS: the safety the public @anon relay needs before strangers post publicly (validator/anonpublic.js,
    // validator/anon-filter.js), and the fid gate on the LIVE public tree (D-PUBLIC-LIVE-TREE):
    //   zk_anon_casts.hidden_at   a removed post is HIDDEN, never deleted: the row stays (hide, never delete), every list
    //                             and the one-cast read skip it. Hour-grained like every anon timestamp.
    //   zk_anon_reports           one row per Report: the cast, a reason from a fixed list, the hour. Deliberately NOT a
    //                             column: the reporter (no address, no device, no fid, no root), a free-text note.
    //   zk_anon_takedowns         the moderator's latest decision per cast (remove | keep), the hour, the moderator's PUBLIC
    //                             key, and the Farcaster delete's state and attempt count (a bounded retry; an outcome that
    //                             could not be confirmed is said as such, never as "removed").
    //   zk_anon_filter_log        the automatic text filter's refusals: the rule id and the hour, NEVER the refused text.
    //   zk_anon_fid_members       the fid gate: one commitment per Farcaster account in the LIVE public tree, the epoch it
    //                             joined (a leaf from the NEXT epoch). The residual, named (R6): the validator learns
    //                             fid -> commitment at join, never who posted. A newer sign-in replaces the row's
    //                             commitment (a lost passkey is not a lockout); a commitment is one fid's only.
    // Hour-grained times only; idempotent (IF NOT EXISTS + the guarded column); reversible (down drops exactly these).
    up: (db) => {
      addColumnIfMissing(db, "zk_anon_casts", "hidden_at", "INTEGER");
      db.exec(`
        CREATE TABLE IF NOT EXISTS zk_anon_reports (
          id TEXT PRIMARY KEY,
          mode TEXT NOT NULL,
          cast_hash TEXT NOT NULL,
          reason TEXT NOT NULL,
          created_hour INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS zk_anon_reports_by_cast ON zk_anon_reports(mode, cast_hash);
        CREATE TABLE IF NOT EXISTS zk_anon_takedowns (
          mode TEXT NOT NULL,
          cast_hash TEXT NOT NULL,
          decision TEXT NOT NULL,
          decided_hour INTEGER NOT NULL,
          moderator_key TEXT NOT NULL,
          delete_state TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (mode, cast_hash)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS zk_anon_filter_log (
          id TEXT PRIMARY KEY,
          mode TEXT NOT NULL,
          rule TEXT NOT NULL,
          created_hour INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS zk_anon_fid_members (
          mode TEXT NOT NULL,
          fid INTEGER NOT NULL,
          commitment TEXT NOT NULL,
          joined_epoch INTEGER NOT NULL,
          PRIMARY KEY (mode, fid)
        ) WITHOUT ROWID;
        CREATE UNIQUE INDEX IF NOT EXISTS zk_anon_fid_members_commitment ON zk_anon_fid_members(mode, commitment);
      `);
    },
    down: (db) => {
      db.exec(`
        DROP INDEX IF EXISTS zk_anon_fid_members_commitment;
        DROP TABLE IF EXISTS zk_anon_fid_members;
        DROP TABLE IF EXISTS zk_anon_filter_log;
        DROP TABLE IF EXISTS zk_anon_takedowns;
        DROP INDEX IF EXISTS zk_anon_reports_by_cast;
        DROP TABLE IF EXISTS zk_anon_reports;
        ALTER TABLE zk_anon_casts DROP COLUMN hidden_at;
      `);
    },
  },
  {
    version: 30,
    name: "anon_fid_leave",
    // PUBLIC GO-LIVE (the relay track, ASM-5) — LEAVING THE FARCASTER-JOINED CROWD. The fid gate's commitment is the device's
    // dedicated identity for the live crowd (lib/zk/anon/fcJoin.ts, never registered under a root: PRIV-LIVE-1), so a root
    // revocation cannot reach it; the device sends a leave signed by that identity's own key (validator/anonpublic.js
    // fidLeave) and the row is marked here:
    //   zk_anon_fid_members.left_epoch   the epoch from which the commitment is NOT a leaf (the epoch after the leave: this
    //                                    epoch's tree is frozen). NULL = in the crowd. The row is KEPT (hide, never delete);
    //                                    only a fresh Sign in with Farcaster by the fid clears it.
    // An epoch number, never a time. Idempotent (the guarded column); reversible (down drops exactly the column).
    up: (db) => {
      addColumnIfMissing(db, "zk_anon_fid_members", "left_epoch", "INTEGER");
    },
    down: (db) => {
      db.exec(`ALTER TABLE zk_anon_fid_members DROP COLUMN left_epoch;`);
    },
  },
];

/** Roll ONE migration back (only 006 has a down), transactionally. */
function migrateDown(db, version, ctx, opts) {
  const m = MIGRATIONS.find((x) => x.version === version);
  if (!m || typeof m.down !== "function") throw new Error("no down-migration for version " + version);
  const applied = db.prepare("SELECT version FROM schema_version WHERE version = ?").get(version);
  if (!applied) throw new Error("migration " + version + " is not applied");
  db.exec("BEGIN");
  try {
    const r = m.down(db, ctx, opts);
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  );`);

  const applied = new Set(
    db.prepare("SELECT version FROM schema_version").all().map((r) => r.version)
  );
  const insert = db.prepare(
    "INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)"
  );

  // PERSONA LAUNCH P5 (W2-MIGRATION-NONATOMIC) — ONE TRANSACTION PER MIGRATION: its up() AND its schema_version row
  // commit together or not at all (SQLite DDL is transactional), as migrateDown already did. Before this, a throw or a
  // kill between two statements of an up() left half a schema with no version row, and the re-run then died on its own
  // ALTER TABLE ("duplicate column name") — a validator that could not boot. Now a failed migration rolls back to the
  // schema it started from, the error is thrown (never swallowed: openDb fails loudly), and the next boot re-runs it.
  let ran = 0;
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      m.up(db);
      insert.run(m.version, m.name, Date.now());
      db.exec("COMMIT");
    } catch (e) {
      // SQLite may already have rolled back on its own (e.g. a full disk): a failing ROLLBACK must not mask the cause
      try {
        db.exec("ROLLBACK");
      } catch {
        /* no transaction left to roll back */
      }
      console.error(`[validator] migration ${m.version} (${m.name}) FAILED and was rolled back: ${e && e.message}`);
      throw e;
    }
    ran++;
    console.log(`[validator] migration ${m.version} (${m.name}) applied`);
  }
  return { ran, current: MIGRATIONS[MIGRATIONS.length - 1].version };
}

module.exports = { migrate, migrateDown, MIGRATIONS };
