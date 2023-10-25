import { describe, expect, it } from 'vitest';

import * as cli from "../src/cli";
//import * as StxTx from "@stacks/transactions";

describe('Bulk transfer generation', async () => {
  const output = await cli.subcommand_create_tx([
    '--json-inputs',
    './tests/fixtures/transaction_inputs.json'
  ]);

  it(`Should return an array of 4 transactions`, () => {
    expect(output).toHaveLength(4);
  });

  for (const i in output) {
    it(`Transaction ${i} should be a base64-encoded string`, () => {
      expect(output[i]).toBeTypeOf('string');
      // TODO: Use regex to check base64 charset
    });
  }
});

describe('Broadcast bulk transactions (dry-run)', async () => {
  const output = await cli.subcommand_broadcast([
    '--json-txs',
    './tests/fixtures/transactions_unsigned.json',
    '--dry-run'
  ]);

  it(`Should return an array of 4 transactions`, () => {
    expect(output).toHaveLength(4);
  });

  for (const i in output) {
    it(`Transaction ${i} should have txid string`, () => {
      expect(output[i].txid).toBeTypeOf('string');
    });
  }
});