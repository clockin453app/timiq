import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BLOCKED_WRITE_PATH_PREFIXES,
  clientMaySendFinanceMutation,
  interpretFinanceWriteState,
  isScopedWritePath,
} from "./finance-scoped-write";

describe("finance scoped write UI gating", () => {
  it("allows only scoped commercial paths", () => {
    assert.equal(isScopedWritePath("/api/finance/contract-value"), true);
    assert.equal(isScopedWritePath("/api/finance/budgets/abc/approve"), true);
    assert.equal(isScopedWritePath("/api/finance/cost-to-complete"), true);
    assert.equal(isScopedWritePath("/api/finance/variations"), true);
    assert.equal(isScopedWritePath("/api/finance/dayworks/x/approve"), true);
    assert.equal(isScopedWritePath("/api/finance/commitments/x/draws"), true);
    assert.equal(isScopedWritePath("/api/finance/applications"), true);
    assert.equal(isScopedWritePath("/api/finance/certificates"), true);
    assert.equal(isScopedWritePath("/api/finance/retention-releases"), true);
  });

  it("keeps payroll cost and ledger mutations blocked in the client gate", () => {
    for (const path of BLOCKED_WRITE_PATH_PREFIXES) {
      assert.equal(isScopedWritePath(path), false);
      assert.equal(
        clientMaySendFinanceMutation(path, { previewModeReadonly: true, writeAllowed: true }),
        false,
      );
    }
  });

  it("shows SCOPED WRITE only when the server says write_allowed", () => {
    const authorised = interpretFinanceWriteState({
      preview_mode_readonly: true,
      readonly: false,
      write_allowed: true,
      scoped_operations: ["contract_value"],
    });
    assert.equal(authorised.chip, "SCOPED WRITE");
    assert.equal(authorised.writeAllowed, true);
    assert.equal(authorised.effectiveReadonly, false);

    const denied = interpretFinanceWriteState({
      preview_mode_readonly: true,
      readonly: true,
      write_allowed: false,
    });
    assert.equal(denied.chip, "READ-ONLY");
    assert.equal(denied.effectiveReadonly, true);

    const missing = interpretFinanceWriteState(null);
    assert.equal(missing.chip, "READ-ONLY");
    assert.equal(missing.writeAllowed, false);
  });

  it("blocks client sends under preview unless scoped and authorised", () => {
    assert.equal(
      clientMaySendFinanceMutation("/api/finance/contract-value", {
        previewModeReadonly: true,
        writeAllowed: false,
      }),
      false,
    );
    assert.equal(
      clientMaySendFinanceMutation("/api/finance/contract-value", {
        previewModeReadonly: true,
        writeAllowed: true,
      }),
      true,
    );
    assert.equal(
      clientMaySendFinanceMutation("/api/finance/worker-payments", {
        previewModeReadonly: true,
        writeAllowed: true,
      }),
      false,
    );
  });
});
