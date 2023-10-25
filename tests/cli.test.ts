import { describe, expect, it, test } from 'vitest';

import * as cli from "../src/cli";
//import * as StxTx from "@stacks/transactions";

describe('Bulk transfer generation', async () => {
  const outputFromCsv = await cli.subcommand_create_tx([
    '--json-inputs',
    './tests/fixtures/transaction_inputs.json'
  ]);

  const outputFromJson = await cli.subcommand_create_tx([
    '--csv-inputs',
    './tests/fixtures/transaction_inputs.csv'
  ]);

  describe('From JSON file', async () => {
    it(`Should return an array of 4 transactions`, () => {
      expect(outputFromJson).toHaveLength(4);
    });

    for (const i in outputFromJson) {
      it(`Transaction ${i} should be a base64-encoded string`, () => {
        expect(outputFromJson[i]).toBeTypeOf('string');
        // TODO: Use regex to check base64 charset
      });
    }
  });

  describe('From CSV file', async () => {
    it(`Should return an array of 4 transactions`, () => {
      expect(outputFromCsv).toHaveLength(4);
    });

    for (const i in outputFromCsv) {
      it(`Transaction ${i} should be a base64-encoded string`, () => {
        expect(outputFromCsv[i]).toBeTypeOf('string');
        // TODO: Use regex to check base64 charset
      });
    }
  });

  test('CSV and JSON input files result in same output', async () => {
    expect(outputFromCsv).toEqual(outputFromJson);
  });
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