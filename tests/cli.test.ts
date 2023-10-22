import { describe, expect, it } from 'vitest';

import * as cli from "../src/cli";
//import * as StxTx from "@stacks/transactions";

describe('Bulk transfer generation', async () => {
  const output = await cli.subcommand_create_tx([
    '--file',
    './tests/fixtures/transaction_inputs.json'
  ]);

  it(`Should return an array of 4 transactions`, () => {
    expect(output).toHaveLength(4);
  });
});
