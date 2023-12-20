import TransportNodeHid from "@ledgerhq/hw-transport-node-hid";
import StxApp from "@zondax/ledger-blockstack";
import readline from "readline";
import { Console } from 'node:console';

import * as fs from 'node:fs';
import * as StxTx from "@stacks/transactions";
import * as lib from "./lib";

async function readInput(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer: string = await new Promise(resolve => {
    rl.question(`${query}? `, answer => resolve(answer));
  });

  rl.close();

  return answer.trim();
}

async function getTransport() {
  //return await SpecTransport.open({ apduPort: 40000 });
  return await TransportNodeHid.create();
}

async function getStxApp(transport: object): Promise<StxApp> {
  console.log("    *** Please make sure your Ledger is connected, unlocked, and the Stacks App is open ***");
  return await new StxApp(transport);
}

//=================
// Subcommands
//=================

export async function subcommand_get_pub(args: string[], transport: object): Promise<string> {
  const app = await getStxApp(transport);
  const path = args[0];
  if (!path) {
    throw new Error("Must supply path as second argument");
  }
  const pubkey = await lib.getPubKey(app, path);
  console.log(`Pub: ${pubkey} @ ${path}`);

  // return value for unit testing
  return pubkey;
}

export async function subcommand_decode(): Promise<StxTx.StacksTransaction> {
  // Decode and print transaction
  const inputPayload = await readInput("Transaction input (base64)");
  const tx = lib.txDecode(inputPayload);
  //const tx = await lib.generateMultiSignedTx();
  console.dir(tx, {depth: null, colors: true});

  // return value for unit testing
  return tx;
}

export async function subcommand_make_multi(args: string[], transport: object): Promise<string> {
  const app = await getStxApp(transport);
  const signers = parseInt(await readInput("Potential signers (number)"));
  const requiredSignatures = parseInt(await readInput("Required signers (number)"));
  const addr = await lib.generateMultiSigAddr(app, signers, requiredSignatures);
  console.log(`Addr: ${addr}`);

  // return value for unit testing
  return addr;
}

export async function subcommand_create_tx(args: string[]): Promise<string[]> {
  // Process args
  const idxJsonInputs = args.indexOf('--json-inputs');
  const idxCsvInputs = args.indexOf('--csv-inputs');
  const idxOutFile = args.indexOf('--out-file');

  // Get inputs
  let inputs: lib.MultisigTxInput[];

  if (idxJsonInputs >= 0) {
    inputs = await lib.makeTxInputsFromFile(args[idxJsonInputs + 1]);
  } else if (idxCsvInputs >= 0) {
    inputs = await lib.makeTxInputsFromCSVFile(args[idxCsvInputs + 1]);
  } else {
    const sender = await readInput("From Address (C32)");
    const publicKeys = (await readInput("From public keys (comma separate)")).split(',').map(x => x.trim());
    const numSignatures = parseInt(await readInput("Required signers (number)"));
    const recipient = await readInput("To Address (C32)");
    const amount = await readInput("microSTX to send");
    const fee = await readInput("microSTX fee (optional)");
    const nonce = await readInput("Nonce (optional)");
    const network = await readInput("Network (optional) [testnet/mainnet]");

    inputs = [
      { sender, recipient, fee, amount, publicKeys, numSignatures, nonce, network }
    ];
  }

  // Generate transactions
  const txs = await lib.makeStxTokenTransfers(inputs);
  const txsEncoded = txs.map(lib.txEncode);

  // Output transactions. Show extra headers and colors if we are not outputting to pipe or file
  let outStream = console;
  let outIsTerm = process.stdout.isTTY;

  if (idxOutFile >= 0) {
    const fileName = args[idxOutFile + 1];
    const stdout = fs.createWriteStream(fileName);
    const stderr = fs.createWriteStream(`${fileName}.err`);
    outStream = new Console({ stdout, stderr });
    outIsTerm = false;
  }
  if (outIsTerm) {
    outStream.log(`Unsigned multisig transaction(s)`);
    outStream.log(`--------------------------------`);
  }
  outStream.log(JSON.stringify(txsEncoded, null, 2));

  // return value for unit testing
  return txsEncoded;
}

export async function subcommand_sign(args: string[], transport: object): Promise<string[]> {
  // Process args
  const idxJsonTxs = args.indexOf('--json-txs');
  const idxCsvKeys = args.indexOf('--csv-keys');
  const idxOutFile = args.indexOf('--out-file');

  const app = await getStxApp(transport);

  // Get transactions
  let txsEncodedIn: string[];

  if (idxJsonTxs >= 0) {
    txsEncodedIn = await lib.encodedTxsFromFile(args[idxJsonTxs + 1]);
  } else {
    const txEncoded = await readInput("Unsigned or partially signed transaction input (base64)");
    txsEncodedIn = [ txEncoded ];
  }

  // Decode transactions
  const txsIn = txsEncodedIn.map(lib.txDecode);
  const txsOut: StxTx.StacksTransaction[] = [];

  // Read key/path mappings if given
  let keyPaths = new Map<string, string>;
  if (idxJsonTxs >= 0) {
    keyPaths = await lib.makeKeyPathMapFromCSVFile(args[idxCsvKeys + 1]);
  }

  // Sign transactions
  for (let tx of txsIn) {
    const info = lib.getAuthFieldInfo(tx);
    let sigs = info.signatures;
    for (const pk of info.pubkeys) {
      if (sigs >= info.signaturesRequired) break;
      const hdPath = keyPaths.get(pk) ?? await readInput(`HD derivation path for ${pk} (empty to skip for this key)`);
      if (!hdPath) continue;
      console.log(`Expecting ${hdPath}=>${pk}...`);
      console.log("    *** Please check and approve signing on Ledger ***");
      tx = await lib.ledgerSignMultisigTx(app, hdPath, tx);
      sigs += 1;
    }
    txsOut.push(tx);
  }

  // Encode and output transactions
  // Show extra headers and colors if we are not outputting to pipe or file
  let outStream = console;
  let outIsTerm = process.stdout.isTTY;

  if (idxOutFile >= 0) {
    const fileName = args[idxOutFile + 1];
    const stdout = fs.createWriteStream(fileName);
    const stderr = fs.createWriteStream(`${fileName}.err`);
    outStream = new Console({ stdout, stderr });
    outIsTerm = false;
  }
  if (outIsTerm) {
    if (txsOut.length === 1) {
      const info = lib.getAuthFieldInfo(txsOut[0]);
      outStream.log(`Signed payload (${info.signatures}/${info.signaturesRequired} required signatures)`);
    } else {
      outStream.log(`Signed payloads`);
    }
    outStream.log(`------------------------------`);
  }

  const txsEncodedOut = txsOut.map(lib.txEncode);
  outStream.log(JSON.stringify(txsEncodedOut, null, 2));

  // return value for unit testing
  return txsEncodedOut;
}

export async function subcommand_broadcast(args: string[]): Promise<StxTx.TxBroadcastResult[]> {
  // Parse args
  const idxJsonTxs = args.indexOf('--json-txs');
  const idxOutFile = args.indexOf('--out-file');
  const dryRun = args.includes('--dry-run');

  // Get transactions
  let txsEncoded: string[];
  if (idxJsonTxs >= 0) {
    txsEncoded = await lib.encodedTxsFromFile(args[idxJsonTxs + 1]);
  } else {
    const txEncoded = await readInput("Signed transaction input (base64)");
    txsEncoded = [ txEncoded ];
  }

  // Decode transactions
  const txs = txsEncoded.map(lib.txDecode);

  // If dry run, replace broadcast fucnction so we don't actually send
  let broadcastFn = StxTx.broadcastTransaction;
  if (dryRun) {
    broadcastFn = async (tx: StxTx.StacksTransaction) => {
      const info = lib.getAuthFieldInfo(tx);
      console.log(`txid ${tx.txid()} (${info.signatures}/${info.signaturesRequired} signers)`);
      return { txid: tx.txid() };
    };
  }

  // Broadcast transactions. Use async so it happens in parallel
  const results = await Promise.all(
    txs.map(async (tx) => await broadcastFn(tx))
  );

  // Output results
  // Show extra headers and colors if we are not outputting to pipe or file
  let outStream = console;

  if (idxOutFile >= 0) {
    const fileName = args[idxOutFile + 1];
    const stdout = fs.createWriteStream(fileName);
    const stderr = fs.createWriteStream(`${fileName}.err`);
    outStream = new Console({ stdout, stderr });
  }
  outStream.log(JSON.stringify(results, null, 2));

  // return value for unit testing
  return results;
}

export function subcommand_help() {
  // TODO
  console.log("Invalid subcommand. See README.md for usage");
}

//=================
// main()
//=================

export async function main(args: string[]) {
  let transport = null;
  const subcommand = args.shift();

  switch (subcommand) {
  case 'get_pub':
    transport = await getTransport();
    await subcommand_get_pub(args, transport);
    break;
  case 'decode':
    await subcommand_decode();
    break;
  case 'make_multi':
    transport = await getTransport();
    await subcommand_make_multi(args, transport);
    break;
  case 'create_tx':
    await subcommand_create_tx(args);
    break;
  case 'sign':
    transport = await getTransport();
    await subcommand_sign(args, transport);
    break;
  case 'broadcast':
    await subcommand_broadcast(args);
    break;
  case 'help':
  case '-h':
  case '--help':
  default:
    subcommand_help();
    break;
  }

  await transport?.close();
}