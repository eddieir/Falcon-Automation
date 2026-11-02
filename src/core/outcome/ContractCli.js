"use strict";

/**
 * ContractCli.js -- WP-77N CLI surface for ContractStore propose/approve/
 * reject (`--contract-propose`, `--contract-approve`, `--contract-reject`,
 * plus `--confirm-digest` and `--store-root`).
 *
 * Exit codes: 2 = invalid input, 1 = store error / refusal, 0 = ok.
 * Never prints store file contents or the contract text; only journeyId,
 * digest, revision, status and the per-assertion summary fields.
 */

const fs = require("fs");
const readline = require("readline");

const Contract = require("./Contract");
const Store = require("./ContractStore");

const ACTION_FLAGS = ["--contract-propose", "--contract-approve", "--contract-reject"];
const KNOWN_FLAGS = ACTION_FLAGS.concat(["--confirm-digest", "--store-root"]);

/** Parse `--flag=value` tokens; each flag at most once; empty value invalid. */
function parseFlags(args) {
    const found = new Map();
    for (const token of args) {
        if (typeof token !== "string") continue;
        const eq = token.indexOf("=");
        if (eq === -1) continue;
        const name = token.slice(0, eq);
        if (!KNOWN_FLAGS.includes(name)) continue;
        const value = token.slice(eq + 1);
        if (found.has(name)) return { ok: false, code: 2 };
        if (value.length === 0) return { ok: false, code: 2 };
        found.set(name, value);
    }
    return { ok: true, flags: found };
}

function printAssertions(stdout, assertions) {
    for (const a of assertions) {
        stdout.write(`${a.id} ${a.required} ${a.check} ${a.locator} ${a.expected === undefined ? "" : a.expected}\n`);
    }
}

/** Bounded, symlink-rejecting read of the contract file. */
async function readContractFile(file) {
    let st;
    try {
        st = await fs.promises.lstat(file);
    } catch (e) {
        return { ok: false, code: 2 };
    }
    if (!st.isFile()) return { ok: false, code: 2 };
    if (st.size > Contract.ALLOWED.MAX_PAYLOAD_BYTES) return { ok: false, code: 2 };
    let text;
    try {
        text = await fs.promises.readFile(file, "utf8");
    } catch (e) {
        return { ok: false, code: 2 };
    }
    if (Buffer.byteLength(text, "utf8") > Contract.ALLOWED.MAX_PAYLOAD_BYTES) return { ok: false, code: 2 };
    return { ok: true, text };
}

/** Read exactly one line from stdin; returns null on EOF/empty/error. */
function readOneLine(stdin, stdout, prompt) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({ input: stdin, output: stdout, terminal: false });
        let answered = false;
        if (prompt) stdout.write(prompt);
        rl.once("line", (line) => {
            answered = true;
            rl.close();
            resolve(line);
        });
        rl.once("close", () => {
            if (!answered) resolve(null);
        });
    });
}

async function run(args, io) {
    const parsed = parseFlags(args);
    if (!parsed.ok) return { handled: true, code: parsed.code };
    const flags = parsed.flags;

    const actionsPresent = ACTION_FLAGS.filter((f) => flags.has(f));
    if (actionsPresent.length === 0) return { handled: false, code: 0 };
    if (actionsPresent.length > 1) return { handled: true, code: 2 };

    const action = actionsPresent[0];
    const file = flags.get(action);
    const confirmDigest = flags.get("--confirm-digest");
    const storeRootOverride = flags.get("--store-root");

    const rootResult = Store.resolveStoreRoot(storeRootOverride, io.repoRoot);
    if (!rootResult.ok) return { handled: true, code: 2 };
    const root = rootResult.root;

    const readResult = await readContractFile(file);
    if (!readResult.ok) return { handled: true, code: readResult.code };

    const parseResult = Contract.parse(readResult.text);
    if (!parseResult.ok) return { handled: true, code: 2 };
    const { value, digest } = parseResult;

    if (action === "--contract-propose") {
        // The store root may not exist on a first run; create it privately.
        // Only propose creates state; approve and reject require an existing store.
        try {
            await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
        } catch {
            io.stdout.write("error STORE_ROOT_UNWRITABLE\n");
            return { handled: true, code: 1 };
        }
        const r = await Store.propose(root, value, { channel: "cli" });
        if (!r.ok) {
            io.stdout.write(`error ${r.code}\n`);
            return { handled: true, code: 1 };
        }
        io.stdout.write(`journeyId ${value.journeyId}\n`);
        io.stdout.write(`digest ${digest}\n`);
        io.stdout.write(`revision ${value.revision}\n`);
        io.stdout.write(`status ${r.status}\n`);
        printAssertions(io.stdout, value.assertions);
        return { handled: true, code: 0 };
    }

    // approve / reject: print assertions + digest first, then require an
    // explicit affirmative confirmation before touching the store.
    printAssertions(io.stdout, value.assertions);
    io.stdout.write(`digest ${digest}\n`);

    let confirmed = false;
    if (confirmDigest !== undefined) {
        confirmed = confirmDigest === digest;
        if (!confirmed) return { handled: true, code: 1 };
    } else if (io.isTTY) {
        const line = await readOneLine(io.stdin, io.stdout, "Type the full digest to confirm: ");
        if (line === null || line === "" || line !== digest) {
            io.stdout.write("Aborted\n");
            return { handled: true, code: 1 };
        }
        confirmed = true;
    } else {
        return { handled: true, code: 1 };
    }

    if (!confirmed) return { handled: true, code: 1 };

    const op = action === "--contract-approve" ? Store.approve : Store.reject;
    const r = await op(root, value.journeyId, digest, { channel: "cli" });
    if (!r.ok) {
        io.stdout.write(`error ${r.code}\n`);
        return { handled: true, code: 1 };
    }
    io.stdout.write(`status ${action === "--contract-approve" ? "APPROVED" : "REJECTED"}\n`);
    return { handled: true, code: 0 };
}

module.exports = { run };
